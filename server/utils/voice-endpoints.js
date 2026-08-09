/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * Where the two speech providers live.
 *
 * Mutable, and deliberately NOT a config knob — the same decision setl records
 * on its own `cartesiaBaseURL` variable: a deployment that could redirect
 * synthesis or transcription at an arbitrary host would be sending it the
 * user's recordings and the assistant's replies along with the API key. The
 * only writer is a test pointing the provider at a local server, which is the
 * only way the request this code actually builds can be asserted against
 * anything but its own source.
 */
module.exports = {
  /** Deepgram's pre-recorded transcription endpoint. The audio is the raw
   * request body; the alternative shape (a JSON `{"url": …}` document) is not
   * used because the audio exists only as the bytes of the upload. */
  deepgramListenUrl: 'https://api.deepgram.com/v1/listen',

  /** Cartesia's API root. `/tts/bytes` is the HTTP streaming endpoint: the
   * whole text goes up in one request and the audio comes back in one
   * response, which is the shape a "speak this message" endpoint needs. */
  cartesiaBaseUrl: 'https://api.cartesia.ai',
};
