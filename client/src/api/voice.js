/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import http from './http';

/* Transformers */

/**
 * A base64 payload as bytes.
 *
 * Both directions of this feature travel base64 inside JSON — see
 * `http.postJson` for why — so the encode on the way out and the decode on the
 * way back are here rather than in the hook, where they would be two more
 * things to mock.
 */
export const bytesToBase64 = (bytes) => {
  // Chunked: `String.fromCharCode(...bytes)` on a 700 KB recording is a spread
  // of 700,000 arguments and throws RangeError in every engine.
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
  }

  return window.btoa(binary);
};

export const base64ToBlob = (data, mimeType) => {
  const binary = window.atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
};

/* Actions */

// Both take an optional `AbortSignal`: these are the two metered endpoints in
// the app, and a turn that has been abandoned — the Stop button, the panel
// closing, the conversation moving to another card — should stop being paid for
// at that moment rather than when its answer arrives and is thrown away.
const transcribeVoiceRecording = (cardId, data, headers, signal) =>
  http.postJson(`/cards/${cardId}/voice/transcription`, data, headers, signal);

const speakMessage = (cardId, data, headers, signal) =>
  http.postJson(`/cards/${cardId}/voice/speech`, data, headers, signal);

export default {
  transcribeVoiceRecording,
  speakMessage,
};
