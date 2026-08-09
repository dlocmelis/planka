const { expect } = require('chai');

const { SWEEP_THRESHOLD, createVoiceRateLimiter } = require('../../utils/voice-rate-limit');

/**
 * The per-user spending caps, driven with an explicit clock rather than a real
 * one — every entry point takes `now`, which is what lets a five-minute window
 * be tested in a millisecond and what keeps these from being flaky.
 */
describe('voice-rate-limit', () => {
  // 4 turns and 100 units per minute, which makes the refill arithmetic easy to
  // read: a quarter of a minute buys one request, and a hundredth buys a unit.
  const limits = { windowMs: 60000, maxRequests: 4, maxUnits: 100 };

  const turn = (limiter, extra = {}) =>
    limiter.reserve({ scope: 'stt', userId: 'u1', limits, units: 10, now: 0, ...extra });

  describe('#reserve()', () => {
    it('should let a user through until their requests run out', () => {
      const limiter = createVoiceRateLimiter();

      for (let index = 0; index < limits.maxRequests; index += 1) {
        expect(turn(limiter).isAllowed, `turn ${index}`).to.equal(true);
      }

      const refused = turn(limiter);

      expect(refused.isAllowed).to.equal(false);
      expect(refused.exceeded).to.equal('requests');
      // A quarter of the window buys the one request that is missing.
      expect(refused.retryAfterSec).to.equal(15);
    });

    it('should refuse on cost even while requests remain', () => {
      const limiter = createVoiceRateLimiter();

      // 100 units of budget, 60 of them asked for at once: the second turn fits
      // and the third does not, with two requests still unspent.
      expect(turn(limiter, { units: 60 }).isAllowed).to.equal(true);
      const refused = turn(limiter, { units: 60 });

      expect(refused.isAllowed).to.equal(false);
      expect(refused.exceeded).to.equal('units');
      // 40 of the 60 are there; the missing 20 are a fifth of a minute away.
      expect(refused.retryAfterSec).to.equal(12);
    });

    it('should refill continuously rather than on a window boundary', () => {
      const limiter = createVoiceRateLimiter();

      for (let index = 0; index < limits.maxRequests; index += 1) {
        turn(limiter);
      }

      expect(turn(limiter, { now: 14000 }).isAllowed).to.equal(false);
      expect(turn(limiter, { now: 15000 }).isAllowed).to.equal(true);

      // ...and it does not run past the ceiling: a bucket left alone for ten
      // windows is worth one window, not ten.
      for (let index = 0; index < limits.maxRequests; index += 1) {
        expect(turn(limiter, { now: 600000 }).isAllowed, `turn ${index}`).to.equal(true);
      }

      expect(turn(limiter, { now: 600000 }).isAllowed).to.equal(false);
    });

    it('should never round a retry down to "right now"', () => {
      const limiter = createVoiceRateLimiter();

      // A window so short that the honest answer is a fraction of a second. A
      // `Retry-After` of 0 would invite the caller straight back into the same
      // refusal, so the floor is one second.
      const brisk = { windowMs: 100, maxRequests: 1, maxUnits: 0 };

      expect(
        limiter.reserve({ scope: 'stt', userId: 'u1', limits: brisk, now: 0 }).isAllowed,
      ).to.eq(true);

      const refused = limiter.reserve({ scope: 'stt', userId: 'u1', limits: brisk, now: 0 });

      expect(refused.isAllowed).to.equal(false);
      expect(refused.retryAfterSec).to.equal(1);
    });

    it('should charge the whole budget for a cost nobody could name', () => {
      const limiter = createVoiceRateLimiter();

      // The conservative direction. Treating an uncountable cost as nothing
      // would let a caller who cannot say what a turn costs have as many of
      // them as the request cap allows, for free. (An ABSENT `units` is a
      // different thing and means zero — a scope with no cost dimension.)
      const first = turn(limiter, { units: NaN });

      expect(first.isAllowed).to.equal(true);
      expect(first.reserved).to.equal(limits.maxUnits);
      expect(turn(limiter, { units: 1 }).isAllowed).to.equal(false);
    });

    it('should let through a turn that could cost more than the whole budget', () => {
      const limiter = createVoiceRateLimiter();

      // Otherwise a deployment whose per-request ceiling is above its per-window
      // budget refuses every turn for ever, and the refusal says "try again in a
      // window" each time. The per-request caps already bound one turn.
      const first = turn(limiter, { units: 1000 });

      expect(first.isAllowed).to.equal(true);
      expect(first.reserved).to.equal(limits.maxUnits);

      expect(turn(limiter, { units: 1000 }).isAllowed).to.equal(false);
    });

    it('should keep users, and the two halves of the feature, apart', () => {
      const limiter = createVoiceRateLimiter();

      for (let index = 0; index < limits.maxRequests; index += 1) {
        turn(limiter);
      }

      expect(turn(limiter).isAllowed).to.equal(false);
      expect(turn(limiter, { userId: 'u2' }).isAllowed).to.equal(true);
      expect(turn(limiter, { scope: 'tts' }).isAllowed).to.equal(true);
    });

    it('should not drain a bucket when the clock goes backwards', () => {
      const limiter = createVoiceRateLimiter();

      expect(turn(limiter, { now: 10000 }).isAllowed).to.equal(true);

      // An NTP step or a suspended container: time appears to have gone the
      // wrong way. It must not be read as a negative refill.
      for (let index = 0; index < limits.maxRequests - 1; index += 1) {
        expect(turn(limiter, { now: 5000 }).isAllowed, `turn ${index}`).to.equal(true);
      }

      expect(turn(limiter, { now: 5000 }).isAllowed).to.equal(false);
    });

    describe('when the deployment has turned limiting off', () => {
      [
        { what: 'the window is zero', limits: { windowMs: 0, maxRequests: 1, maxUnits: 1 } },
        {
          what: 'both dimensions are zero',
          limits: { windowMs: 60000, maxRequests: 0, maxUnits: 0 },
        },
        { what: 'there are no limits at all', limits: null },
      ].forEach(({ what, limits: off }) => {
        it(`should allow everything when ${what}`, () => {
          const limiter = createVoiceRateLimiter();

          for (let index = 0; index < 50; index += 1) {
            const result = limiter.reserve({
              scope: 'stt',
              userId: 'u1',
              limits: off,
              units: 1000,
              now: 0,
            });

            expect(result.isAllowed, `turn ${index}`).to.equal(true);
          }

          // Nothing is remembered about a user nobody is limiting.
          expect(limiter.size()).to.equal(0);
        });
      });

      it('should still limit the dimension that is left on', () => {
        const limiter = createVoiceRateLimiter();
        const requestsOnly = { windowMs: 60000, maxRequests: 2, maxUnits: 0 };

        const take = () =>
          limiter.reserve({ scope: 'stt', userId: 'u1', limits: requestsOnly, units: 1e9, now: 0 });

        expect(take().isAllowed).to.equal(true);
        expect(take().isAllowed).to.equal(true);
        expect(take().isAllowed).to.equal(false);
      });
    });
  });

  describe('#settle()', () => {
    const settle = (limiter, spent, extra = {}) =>
      limiter.settle({ scope: 'stt', userId: 'u1', limits, reserved: 10, spent, now: 0, ...extra });

    it('should give back what a turn reserved and did not spend', () => {
      const limiter = createVoiceRateLimiter();

      // This is the case the whole reserve/settle split exists for: a
      // conversation of ordinary short turns must never come near a budget
      // sized for the worst one. Ten turns each reserving a tenth of the budget
      // and each really costing a unit would otherwise stop at the tenth.
      for (let index = 0; index < 10; index += 1) {
        const reservation = limiter.reserve({
          scope: 'stt',
          userId: 'u1',
          limits: { ...limits, maxRequests: 0 },
          units: 10,
          now: 0,
        });

        expect(reservation.isAllowed, `turn ${index}`).to.equal(true);

        settle(limiter, 1, { limits: { ...limits, maxRequests: 0 } });
      }

      const after = limiter.reserve({
        scope: 'stt',
        userId: 'u1',
        limits: { ...limits, maxRequests: 0 },
        units: 60,
        now: 0,
      });

      expect(after.isAllowed).to.equal(true);
    });

    it('should take the excess when a turn cost more than it reserved', () => {
      const limiter = createVoiceRateLimiter();

      expect(turn(limiter, { units: 10 }).isAllowed).to.equal(true);
      settle(limiter, 95);

      // 100 - 95 spent leaves 5, so a turn that wants 10 has to wait.
      const refused = turn(limiter, { units: 10 });

      expect(refused.isAllowed).to.equal(false);
      expect(refused.exceeded).to.equal('units');
    });

    it('should never refill a bucket past its ceiling', () => {
      const limiter = createVoiceRateLimiter();

      turn(limiter, { units: 10 });
      // A settle that claims to have spent nothing against a reservation ten
      // times what was taken must not mint budget out of nothing: the bucket
      // comes back to its ceiling of 100 and no further.
      settle(limiter, 0, { reserved: 1000 });

      expect(turn(limiter, { units: 100 }).isAllowed).to.equal(true);
      expect(turn(limiter, { units: 1 }).isAllowed).to.equal(false);
    });

    it('should not let a nonsense figure remove the cap', () => {
      const limiter = createVoiceRateLimiter();

      turn(limiter, { units: 100 });
      // NaN or Infinity in a bucket does not throw — it makes every later
      // comparison false, which reads as "there is room" and quietly turns the
      // whole thing off. The costs come from a provider's JSON and a caller's
      // payload, so this should be unreachable; a cap that fails open is worth
      // making sure of.
      settle(limiter, NaN, { reserved: 100 });
      settle(limiter, undefined, { reserved: Infinity });

      const refused = turn(limiter, { units: 10 });

      expect(refused.isAllowed).to.equal(false);
      expect(refused.exceeded).to.equal('units');
    });

    it('should do nothing for a user with no bucket', () => {
      const limiter = createVoiceRateLimiter();

      settle(limiter, 0);

      expect(limiter.size()).to.equal(0);
    });
  });

  describe('the bucket store', () => {
    it('should forget users whose budget has fully come back', () => {
      const limiter = createVoiceRateLimiter();

      for (let index = 0; index < SWEEP_THRESHOLD; index += 1) {
        limiter.reserve({ scope: 'stt', userId: `u${index}`, limits, units: 1, now: 0 });
      }

      expect(limiter.size()).to.equal(SWEEP_THRESHOLD);

      // One more user, a window later: everything before it has refilled and is
      // indistinguishable from a user who never spoke, so it goes.
      limiter.reserve({ scope: 'stt', userId: 'late', limits, units: 1, now: limits.windowMs });

      expect(limiter.size()).to.equal(1);
    });

    it('should keep users who are still inside their window', () => {
      const limiter = createVoiceRateLimiter();

      for (let index = 0; index < SWEEP_THRESHOLD; index += 1) {
        limiter.reserve({ scope: 'stt', userId: `u${index}`, limits, units: 1, now: 0 });
      }

      limiter.reserve({ scope: 'stt', userId: 'late', limits, units: 1, now: 1000 });

      expect(limiter.size()).to.equal(SWEEP_THRESHOLD + 1);
    });

    it('should apply a lowered cap to a bucket that already exists', () => {
      const limiter = createVoiceRateLimiter();

      turn(limiter, { units: 1 });

      // The operator cuts the budget and the process is not restarted: a bucket
      // holding more than the new ceiling — 3 requests and 99 units against a
      // ceiling of 1 and 5 — is clamped down to it rather than spending the old
      // one out first. So exactly one more turn fits, not three.
      const lowered = { windowMs: 60000, maxRequests: 1, maxUnits: 5 };
      const take = () =>
        limiter.reserve({ scope: 'stt', userId: 'u1', limits: lowered, units: 5, now: 0 });

      expect(take().isAllowed).to.equal(true);

      const refused = take();

      expect(refused.isAllowed).to.equal(false);
      expect(refused.exceeded).to.equal('requests');
    });

    it('should forget everything on reset', () => {
      const limiter = createVoiceRateLimiter();

      for (let index = 0; index < limits.maxRequests; index += 1) {
        turn(limiter);
      }

      expect(turn(limiter).isAllowed).to.equal(false);

      limiter.reset();

      expect(limiter.size()).to.equal(0);
      expect(turn(limiter).isAllowed).to.equal(true);
    });
  });
});
