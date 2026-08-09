/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * Per-user spending caps for the two metered voice endpoints.
 *
 * These are the only two routes in PLANKA that cost the deployment money per
 * request: transcription is billed per audio minute and synthesis per
 * synthesized character, both against a key the operator put in the
 * environment. Every other cap in this feature bounds ONE request — the upload
 * size, the audio duration, the character count — and nothing bounded how many
 * of them a single account could make, so any board member could turn the
 * deployment's Deepgram and Cartesia keys into an open service by holding down
 * a script.
 *
 * ## Two dimensions, because one is not enough
 *
 * A request cap alone is a cost cap only if every request costs the same, and
 * these do not: one turn may be a two-second "yes" and the next a five-minute
 * monologue. A cost cap alone lets a caller make thousands of tiny requests,
 * each of them free here and each of them a round trip to the vendor. So a
 * bucket holds both, and a turn needs room in both to run.
 *
 * ## Token buckets rather than a fixed window
 *
 * A fixed window ("20 per 5 minutes, counter resets on the boundary") lets a
 * caller spend two whole windows within a second of each other by sitting on
 * the boundary. A token bucket refills continuously — `maxRequests` tokens per
 * `windowMs` — so the same two numbers describe the burst AND the sustained
 * rate, and there is no boundary to sit on.
 *
 * ## Reserve, then settle
 *
 * What a turn will cost is not known until it is over: the provider reports the
 * audio duration, and the text that is synthesized is prepared server-side and
 * can be longer than what was sent. So a turn RESERVES the most it could
 * possibly cost before the provider is called and settles to what it actually
 * cost after — refunding the difference, or charging the excess.
 *
 * That ordering is the point. Charging afterwards alone would let a caller run
 * any number of turns in parallel, every one of them checking a budget none of
 * them had spent yet.
 *
 * ## What this deliberately is not
 *
 * It is per PROCESS, held in memory. PLANKA has no shared cache — the socket
 * layer is the only cross-instance channel and it carries nothing like this —
 * so a deployment running N instances behind a load balancer enforces N times
 * these numbers. That is written down in `docs/bot-chat-voice.md` rather than
 * papered over: the caps exist to stop one account spending without bound, and
 * a factor of N on a per-user cap still does that.
 *
 * It is also not a defence against a flood of REQUESTS as such — an unbounded
 * number of them are still parsed and authenticated before they reach here.
 * What it bounds is the spend behind them.
 */

/** How many buckets may pile up before idle ones are swept out. A bucket is a
 * few dozen bytes and only exists for a user who has spoken, so this is
 * generous for any real instance while still bounding the map on a deployment
 * being hammered from many accounts. */
const SWEEP_THRESHOLD = 1024;

const keyFor = (scope, userId) => `${scope}:${userId}`;

/**
 * A limit set as this module understands it, or null when the caller has turned
 * limiting off. Any non-positive number disables the dimension it belongs to,
 * and a non-positive window disables the whole thing — which is what an
 * operator who already limits at their reverse proxy asks for.
 */
const normalizeLimits = (limits) => {
  if (!limits || !(limits.windowMs > 0)) {
    return null;
  }

  const maxRequests = limits.maxRequests > 0 ? limits.maxRequests : Infinity;
  const maxUnits = limits.maxUnits > 0 ? limits.maxUnits : Infinity;

  if (maxRequests === Infinity && maxUnits === Infinity) {
    return null;
  }

  return { windowMs: limits.windowMs, maxRequests, maxUnits };
};

/** The bucket as it stands `now`, having refilled since it was last touched.
 * Pure: it answers with the new state rather than writing it, so the one place
 * that owns a bucket is the only place that changes one. */
const refilled = (bucket, limits, now) => {
  // A clock that went backwards — NTP, a suspended container — must not drain
  // anything; it just means no time has passed.
  const fraction = Math.max(0, now - bucket.updatedAt) / limits.windowMs;

  return {
    requests: Math.min(limits.maxRequests, bucket.requests + fraction * limits.maxRequests),
    units: Math.min(limits.maxUnits, bucket.units + fraction * limits.maxUnits),
    updatedAt: now,
    limits,
  };
};

/** Whether a bucket has sat untouched for long enough to be fully refilled, and
 * so is indistinguishable from a user who has never spoken — which is what
 * makes it safe to forget. */
const isForgettable = (bucket, now) => now - bucket.updatedAt >= bucket.limits.windowMs;

/**
 * Whether a figure is one the buckets can do arithmetic with.
 *
 * NaN or Infinity reaching a bucket would not throw — it would make every later
 * comparison against that bucket false, which reads as "there is room" and
 * silently removes the cap. The figures come from a provider's own JSON (an
 * audio duration) and from a caller's payload length, so neither should ever be
 * one; a limit that fails open is worth two lines of not finding out.
 */
const isCountable = (value) => typeof value === 'number' && Number.isFinite(value);

/** What a turn takes out of the bucket. An unknown cost is charged the whole
 * budget rather than nothing — the conservative direction, since the caller
 * asking for it is the one that could not say what it would cost. */
const reservationFor = (units, capacity) =>
  isCountable(units) ? Math.min(Math.max(0, units), capacity) : capacity;

/** How long until `missing` more tokens have refilled, in whole seconds and
 * never zero — a `Retry-After` of 0 is an invitation to retry immediately,
 * which is the one answer that is certainly wrong. */
const secondsToRefill = (missing, capacity, windowMs) =>
  Math.max(1, Math.ceil((missing / capacity) * (windowMs / 1000)));

/**
 * One store of buckets.
 *
 * A factory rather than bare module state so a test can drive its own store
 * with its own clock instead of reaching into this file's variables. The
 * instance created at the bottom is the only one the app itself uses.
 */
const createVoiceRateLimiter = () => {
  const buckets = new Map();

  const sweep = (now) => {
    buckets.forEach((bucket, key) => {
      if (isForgettable(bucket, now)) {
        buckets.delete(key);
      }
    });
  };

  const bucketFor = (key, limits, now) => {
    const existing = buckets.get(key);

    if (!existing) {
      if (buckets.size >= SWEEP_THRESHOLD) {
        sweep(now);
      }

      const bucket = {
        requests: limits.maxRequests,
        units: limits.maxUnits,
        updatedAt: now,
        limits,
      };
      buckets.set(key, bucket);

      return bucket;
    }

    // The limits can change under a bucket — an operator edits the environment
    // and restarts, a test re-points the config — so what is above the new
    // ceiling is clamped down to it and a lowered cap takes effect at once.
    // `refilled` has already clamped; this is only for the case where nothing
    // refilled because no time had passed.
    const bucket = refilled(existing, limits, now);
    bucket.requests = Math.min(bucket.requests, limits.maxRequests);
    bucket.units = Math.min(bucket.units, limits.maxUnits);

    Object.assign(existing, bucket);

    return existing;
  };

  return {
    /**
     * Take one turn's worth of budget, or say why not.
     *
     * `units` is the MOST this turn could cost, in whatever the scope is
     * measured in — audio seconds for transcription, characters for synthesis.
     * The caller settles it to the real figure afterwards.
     *
     * Answers `{ isAllowed: true, reserved }`, or `{ isAllowed: false,
     * retryAfterSec, exceeded }` where `exceeded` names which of the two
     * dimensions ran out, for the log line.
     */
    reserve({ scope, userId, limits, units = 0, now = Date.now() }) {
      const normalized = normalizeLimits(limits);

      if (!normalized) {
        return { isAllowed: true, reserved: 0 };
      }

      const bucket = bucketFor(keyFor(scope, userId), normalized, now);

      if (bucket.requests < 1) {
        return {
          isAllowed: false,
          exceeded: 'requests',
          retryAfterSec: secondsToRefill(
            1 - bucket.requests,
            normalized.maxRequests,
            normalized.windowMs,
          ),
        };
      }

      // A single turn that could cost more than the entire budget would never
      // be affordable, and answering "come back in a window" for ever is worse
      // than letting one through — the per-request caps already bound what one
      // turn can spend. So a turn reserves what it asks for or the whole
      // budget, whichever is less.
      const wanted = reservationFor(units, normalized.maxUnits);

      if (bucket.units < wanted) {
        return {
          isAllowed: false,
          exceeded: 'units',
          retryAfterSec: secondsToRefill(
            wanted - bucket.units,
            normalized.maxUnits,
            normalized.windowMs,
          ),
        };
      }

      bucket.requests -= 1;
      bucket.units -= wanted;

      return { isAllowed: true, reserved: wanted };
    },

    /**
     * Correct a reservation to what the turn actually cost.
     *
     * `spent` under `reserved` gives the difference back; over it takes the
     * excess, which can push the bucket negative — deliberately, because a turn
     * that cost more than it reserved has already been paid for and the next
     * one should wait for it. The request itself is never given back: it was
     * made.
     */
    settle({ scope, userId, limits, reserved = 0, spent = 0, now = Date.now() }) {
      const normalized = normalizeLimits(limits);

      // A figure that cannot be counted leaves the reservation standing, which
      // is what a turn whose cost nobody could establish should be charged.
      if (!normalized || !isCountable(reserved) || !isCountable(spent) || reserved === spent) {
        return;
      }

      const correction = reserved - spent;

      const bucket = buckets.get(keyFor(scope, userId));

      if (!bucket) {
        return;
      }

      Object.assign(bucket, refilled(bucket, normalized, now));
      bucket.units = Math.min(normalized.maxUnits, bucket.units + correction);
    },

    /** Forget everything. For tests, and for nothing else — there is no
     * operational reason to hand a user back their budget. */
    reset() {
      buckets.clear();
    },

    /** How many buckets are being tracked, so the sweep can be tested for what
     * it is: an eviction, not a leak. */
    size() {
      return buckets.size;
    },
  };
};

/** The instance the two controllers share. */
const voiceRateLimiter = createVoiceRateLimiter();

module.exports = {
  SWEEP_THRESHOLD,
  createVoiceRateLimiter,
  voiceRateLimiter,
};
