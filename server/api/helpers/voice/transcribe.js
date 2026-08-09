/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * One complete audio blob → one transcript, through Deepgram's pre-recorded
 * /v1/listen endpoint.
 *
 * Ported from setl's `data/core/stt/deepgram.go`, down to the query it builds
 * and the fields it reads back. Two of those parameters are worth knowing
 * rather than copying blind:
 *
 *  - `keyterm` is REPEATED once per term and is the Nova-3 feature. The older
 *    `keywords` (with its weight syntax) belongs to Nova-2 and is silently
 *    ignored by Nova-3, so using it would look configured and do nothing.
 *  - `smart_format` returns numbers, currencies and dates written the way a
 *    person would type them, which is what a chat composer needs — the raw
 *    spoken form is not something a user wants to edit by hand.
 *
 * THE AUDIO IS NEVER PERSISTED. It is decoded from the request, held only long
 * enough to be forwarded, and dropped when this returns: no temp file, no
 * attachment record, no log line carrying it. That is a privacy decision about
 * recordings of people's voices, not an omission — a change that wants to keep
 * audio (for a retry, for debugging) is changing that contract.
 */

const { ProxyAgent } = require('undici');

const endpoints = require('../../../utils/voice-endpoints');
const {
  MAX_PROVIDER_ERROR_BYTES,
  VoiceProviderError,
  VoiceRequestError,
  readBoundedBody,
} = require('../../../utils/voice');

/**
 * The ceiling on a transcript response, as a backstop rather than a business
 * rule: a five-minute recording comes back as tens of kilobytes of JSON —
 * Deepgram's per-word timings are the bulk of it — so this is two orders of
 * magnitude above anything real, and exists only so a provider having a bad day
 * cannot be an unbounded allocation on this process.
 */
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;

const buildUrl = (config, language) => {
  const url = new URL(endpoints.deepgramListenUrl);

  url.searchParams.set('model', config.model);

  const resolvedLanguage = (language || '').trim() || config.language;
  if (resolvedLanguage) {
    url.searchParams.set('language', resolvedLanguage);
  }

  url.searchParams.set('smart_format', 'true');

  config.keyterms.forEach((term) => {
    url.searchParams.append('keyterm', term);
  });

  return url.toString();
};

module.exports = {
  inputs: {
    audio: {
      type: 'ref',
      required: true,
    },
    mimeType: {
      type: 'string',
      required: true,
    },
    language: {
      type: 'string',
      allowNull: true,
    },
  },

  async fn(inputs) {
    const { stt } = sails.helpers.voice.getConfig();

    if (!stt) {
      throw new Error('Speech-to-text is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), stt.timeoutSec * 1000);

    let response;
    let body;
    try {
      response = await fetch(buildUrl(stt, inputs.language), {
        method: 'POST',
        headers: {
          Authorization: `Token ${stt.apiKey}`,
          // Deepgram sniffs the container itself, but passing the uploaded type
          // through is what lets it skip the guess for the formats it knows.
          'Content-Type': inputs.mimeType,
        },
        body: inputs.audio,
        signal: controller.signal,
        dispatcher: sails.config.custom.outgoingProxy
          ? new ProxyAgent(sails.config.custom.outgoingProxy)
          : undefined,
      });

      // Read here, INSIDE the window the abort timer covers. Clearing that
      // timer when the headers arrive — which is where a `finally` around the
      // fetch alone puts it — leaves the body read unbounded in time, so a
      // provider that stalls mid-body pins this request and its buffers for as
      // long as it likes.
      body = await readBoundedBody(
        response,
        response.ok ? MAX_TRANSCRIPT_BYTES : MAX_PROVIDER_ERROR_BYTES,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // Cap what is quoted back: an upstream error page is not a payload we
      // control, and it ends up in a log line.
      throw new VoiceProviderError(
        stt.provider,
        response.status,
        body.buffer.toString('utf8').slice(0, 2048),
      );
    }

    if (!body.ok) {
      throw new VoiceProviderError(
        stt.provider,
        response.status,
        'transcript response is too large',
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(body.buffer.toString('utf8'));
    } catch (error) {
      throw new VoiceProviderError(
        stt.provider,
        response.status,
        'transcript response is not JSON',
      );
    }

    const channel =
      parsed && parsed.results && Array.isArray(parsed.results.channels)
        ? parsed.results.channels[0]
        : undefined;
    const alternative =
      channel && Array.isArray(channel.alternatives) ? channel.alternatives[0] : undefined;

    const result = {
      text: alternative && alternative.transcript ? String(alternative.transcript).trim() : '',
      durationSec:
        parsed && parsed.metadata && typeof parsed.metadata.duration === 'number'
          ? parsed.metadata.duration
          : 0,
      languages: [],
      confidence: null,
    };

    // A pointer in Go, a `typeof` here, and for the same reason: 0.0 is a real
    // confidence a provider can return, so it cannot double as "absent".
    if (alternative && typeof alternative.confidence === 'number') {
      result.confidence = alternative.confidence;
    }

    if (channel) {
      if (Array.isArray(channel.languages) && channel.languages.length > 0) {
        result.languages = channel.languages;
      } else if (channel.detected_language) {
        result.languages = [channel.detected_language];
      }
    }

    // A monolingual request reports no language of its own, so the mode that
    // was asked for is the answer — otherwise every caller would have to
    // re-derive it from config to label the transcript.
    if (result.languages.length === 0) {
      const requested = (inputs.language || '').trim() || stt.language;

      if (requested && requested !== 'multi') {
        result.languages = [requested];
      }
    }

    // Enforced here rather than before the call because nothing in a
    // browser-produced webm/ogg container states the duration reliably
    // (MediaRecorder writes an unknown-duration header), so the provider's own
    // measurement is the first trustworthy one. The transcript is discarded
    // rather than returned truncated.
    if (stt.maxDurationSec > 0 && result.durationSec > stt.maxDurationSec) {
      throw new VoiceRequestError(
        `Audio is too long: ${result.durationSec.toFixed(1)}s exceeds the ${stt.maxDurationSec}s limit`,
      );
    }

    return result;
  },
};
