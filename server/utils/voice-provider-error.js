/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * A non-2xx answer from a speech provider's API.
 *
 * Typed so a caller can tell an upstream refusal (bad key, unsupported audio,
 * rate limit) from a transport failure and choose a status code for it —
 * setl's `stt.ProviderError`, in the shape this codebase writes errors.
 */
class VoiceProviderError extends Error {
  constructor(provider, statusCode, body) {
    const trimmed = String(body || '').trim();

    super(
      trimmed === ''
        ? `${provider} returned HTTP ${statusCode}`
        : `${provider} returned HTTP ${statusCode}: ${trimmed}`,
    );

    this.name = 'VoiceProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
    this.body = trimmed;
  }

  /**
   * Whether re-sending the same request could plausibly succeed: rate limiting
   * and provider-side faults, never a 4xx that describes the request itself.
   *
   * Nothing retries automatically — a recording is never re-uploaded on its
   * own — but the classification is what a caller needs to phrase the failure.
   */
  get isRetryable() {
    return this.statusCode === 429 || this.statusCode >= 500;
  }
}

module.exports = VoiceProviderError;
