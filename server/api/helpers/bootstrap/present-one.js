/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

module.exports = {
  sync: true,

  inputs: {
    internalConfig: {
      type: 'ref',
      required: true,
    },
    oidc: {
      type: 'ref',
    },
    user: {
      type: 'ref',
    },
  },

  fn(inputs) {
    const voice = sails.helpers.voice.getConfig();

    const data = {
      oidc: inputs.oidc,
      termsLanguages: sails.hooks.terms.getLanguages(),
      version: sails.config.custom.version,
      // What the voice chat mode of the planka_bot panel may do here. Absence
      // is OFF on the client side, so an older server (or a failed bootstrap)
      // never renders a control whose endpoint would 503 — the same rule
      // setl-web reads `ttsEnabled` by. The two halves are reported separately
      // because they are separate credentials: a deployment may be able to
      // hear and not speak.
      voiceChat: {
        sttEnabled: !!voice.stt,
        ttsEnabled: !!voice.tts,
        // The caps the client checks a recording and a message against BEFORE
        // uploading, so an oversized one is refused with a sentence instead of
        // a round trip. Null when that half is off — there is no ceiling to
        // report for a feature that is not there.
        sttMaxBytes: voice.stt ? voice.stt.maxBytes || null : null,
        sttMaxDurationSec: voice.stt ? voice.stt.maxDurationSec || null : null,
        ttsMaxChars: voice.tts ? voice.tts.maxChars || null : null,
      },
    };

    if (inputs.user && inputs.user.role === User.Roles.ADMIN) {
      Object.assign(data, {
        activeUsersLimit: inputs.internalConfig.activeUsersLimit,
        customerPanelUrl: sails.config.custom.customerPanelUrl,
      });
    }

    if (sails.config.custom.demoMode) {
      data.isDemoMode = true;
    }

    return data;
  },
};
