/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * Where the two speech providers live.
 *
 * Deliberately NOT a config knob — the same decision setl records on its own
 * `cartesiaBaseURL` variable: a deployment that could redirect synthesis or
 * transcription at an arbitrary host would be sending it the user's recordings
 * and the assistant's replies along with the API key.
 *
 * They are readable and not writable. There is exactly one legitimate reason to
 * change them — a test pointing the providers at a local server, which is the
 * only way the request this code builds can be asserted against anything but
 * its own source — and that reason has a name, `useVoiceEndpoints`, which hands
 * back the function that puts them back. Assigning to one instead throws rather
 * than quietly succeeding, so a future test cannot half-redirect the providers
 * and leave the real hostnames in place for whatever runs after it.
 */

const DEFAULT_ENDPOINTS = Object.freeze({
  /** Deepgram's pre-recorded transcription endpoint. The audio is the raw
   * request body; the alternative shape (a JSON `{"url": …}` document) is not
   * used because the audio exists only as the bytes of the upload. */
  deepgramListenUrl: 'https://api.deepgram.com/v1/listen',

  /** Cartesia's API root. `/tts/bytes` is the HTTP streaming endpoint: the
   * whole text goes up in one request and the audio comes back in one
   * response, which is the shape a "speak this message" endpoint needs. */
  cartesiaBaseUrl: 'https://api.cartesia.ai',
});

let current = DEFAULT_ENDPOINTS;

const refuseWrite = (name) => {
  throw new Error(
    `${name} is not writable; call useVoiceEndpoints() and the restore function it returns`,
  );
};

module.exports = Object.freeze({
  get deepgramListenUrl() {
    return current.deepgramListenUrl;
  },

  set deepgramListenUrl(value) {
    refuseWrite('deepgramListenUrl');
  },

  get cartesiaBaseUrl() {
    return current.cartesiaBaseUrl;
  },

  set cartesiaBaseUrl(value) {
    refuseWrite('cartesiaBaseUrl');
  },

  /**
   * Point one or both providers somewhere else, and answer with the function
   * that puts them back. For tests; nothing in the app calls it.
   *
   * The overrides are applied over the DEFAULTS rather than over whatever is
   * current, so a caller that names one endpoint gets the real hostname for the
   * other and cannot accidentally inherit a previous test's stub.
   */
  useVoiceEndpoints(overrides) {
    const previous = current;
    current = Object.freeze({ ...DEFAULT_ENDPOINTS, ...overrides });

    return () => {
      current = previous;
    };
  },
});
