/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * A refusal that is the caller's fault: the recording, the message or the hint
 * they sent.
 *
 * Kept apart from `VoiceProviderError` because the two map to different status
 * codes and different sentences — one says "fix what you sent", the other says
 * "this was not you".
 */
class VoiceRequestError extends Error {
  constructor(message) {
    super(message);

    this.name = 'VoiceRequestError';
  }
}

module.exports = VoiceRequestError;
