/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /cards/{cardId}/voice/transcription:
 *   post:
 *     summary: Transcribe a voice recording
 *     description: >
 *       Transcribes one complete audio recording and returns the text, for the
 *       voice chat mode of the planka_bot chat panel. Requires the same board
 *       permissions as commenting on the card, because the transcript is what
 *       the panel is about to post as a comment. The audio is never stored.
 *     tags:
 *       - Voice
 *     operationId: transcribeVoiceRecording
 *     parameters:
 *       - name: cardId
 *         in: path
 *         required: true
 *         description: ID of the card the conversation is on
 *         schema:
 *           type: string
 *           example: "1357158568008091264"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - data
 *               - mimeType
 *             properties:
 *               data:
 *                 type: string
 *                 description: The recording, base64-encoded
 *               mimeType:
 *                 type: string
 *                 description: Content type the recording was produced with
 *                 example: audio/webm;codecs=opus
 *               language:
 *                 type: string
 *                 description: Language mode for this request only ("multi" or a BCP-47 code)
 *                 example: multi
 *     responses:
 *       200:
 *         description: Recording transcribed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - item
 *               properties:
 *                 item:
 *                   type: object
 *                   required:
 *                     - text
 *                     - languages
 *                     - durationSec
 *                   properties:
 *                     text:
 *                       type: string
 *                       description: The transcript; empty when nothing was heard
 *                     languages:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: BCP-47 tags for the transcript, most-spoken first
 *                     durationSec:
 *                       type: number
 *                     confidence:
 *                       type: number
 *                       nullable: true
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/UnprocessableEntity'
 *       502:
 *         $ref: '#/components/responses/BadGateway'
 *       503:
 *         $ref: '#/components/responses/ServiceUnavailable'
 */

const { idInput } = require('../../../utils/inputs');
const {
  VoiceProviderError,
  VoiceRequestError,
  allowedAudioMimeTypes,
  formatBytes,
  normalizeAudioMimeType,
} = require('../../../utils/voice');

const Errors = {
  NOT_ENOUGH_RIGHTS: {
    notEnoughRights: 'Not enough rights',
  },
  CARD_NOT_FOUND: {
    cardNotFound: 'Card not found',
  },
  NOT_CONFIGURED: {
    notConfigured: 'Speech-to-text is not configured on this server',
  },
  INVALID_RECORDING: {
    invalidRecording: 'Invalid recording',
  },
  TRANSCRIPTION_FAILED: {
    transcriptionFailed: 'Transcription failed',
  },
};

module.exports = {
  inputs: {
    cardId: {
      ...idInput,
      required: true,
    },
    data: {
      type: 'string',
      required: true,
      // Base64 of the byte cap plus slack for the encoding's padding. The real
      // bound is voiceSttMaxBytes, checked against the DECODED length below —
      // this only keeps a hopeless string from being decoded at all.
      //
      // One megabyte and not more, because that is the ceiling the body parser
      // in front of this route enforces anyway (skipper's default, not
      // overridden in `config/http.js`): the default 700 KB cap is ~956 KB
      // encoded, so a value above this could never be reached and would only
      // describe a limit that does not exist.
      maxLength: 1024 * 1024,
    },
    mimeType: {
      type: 'string',
      required: true,
      maxLength: 128,
    },
    language: {
      type: 'string',
      maxLength: 32,
      allowNull: true,
      // Validated rather than forwarded. It goes straight into the provider's
      // query string, so a value it does not know costs a billed round trip and
      // comes back as the misleading "that recording could not be transcribed;
      // try recording it again" — advice for a problem the caller does not
      // have. `multi` is Nova-3's code-switching mode; anything else is a
      // BCP-47 tag, which is what the synthesis half already insists on.
      regex: /^(multi|[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*)$/,
    },
  },

  exits: {
    notEnoughRights: {
      responseType: 'forbidden',
    },
    cardNotFound: {
      responseType: 'notFound',
    },
    notConfigured: {
      responseType: 'serviceUnavailable',
    },
    // The house idiom for "your upload was wrong" — the same response
    // attachments/create answers `uploadError` with, and the same `{code,
    // message}` body every other planka error uses, which is what the client
    // reads the sentence out of.
    invalidRecording: {
      responseType: 'unprocessableEntity',
    },
    transcriptionFailed: {
      responseType: 'badGateway',
    },
  },

  async fn(inputs) {
    const { currentUser } = this.req;

    const { stt } = sails.helpers.voice.getConfig();

    // The gate first, before anything is decoded: a deployment with no
    // credential must answer the same 503 whatever was uploaded.
    if (!stt) {
      throw Errors.NOT_CONFIGURED;
    }

    // The upload is validated before the card is resolved. It is cheap, it
    // describes only the caller's own request — so it discloses nothing about a
    // card they may not see, which still 404s below, before any billable
    // provider call — and it keeps a malformed recording from costing a
    // database round trip.
    const mimeType = normalizeAudioMimeType(inputs.mimeType);

    if (!mimeType) {
      throw {
        invalidRecording: `Unsupported audio content type '${inputs.mimeType}' (accepted: ${allowedAudioMimeTypes().join(', ')})`,
      };
    }

    const audio = Buffer.from(inputs.data, 'base64');

    if (audio.length === 0) {
      throw { invalidRecording: 'Recording is empty' };
    }

    // Nothing is ever truncated to fit: a transcript that silently stops
    // mid-sentence is worse than a refusal the user can act on.
    if (stt.maxBytes > 0 && audio.length > stt.maxBytes) {
      throw {
        invalidRecording: `Recording is too large: ${formatBytes(audio.length)} exceeds the ${formatBytes(stt.maxBytes)} limit`,
      };
    }

    const { card, board } = await sails.helpers.cards
      .getPathToProjectById(inputs.cardId)
      .intercept('pathNotFound', () => Errors.CARD_NOT_FOUND);

    const boardMembership = await BoardMembership.qm.getOneByBoardIdAndUserId(
      board.id,
      currentUser.id,
    );

    // A card that does not exist and one that belongs to a board the caller is
    // not on are the same 404 — the rule POST /cards/:id/comments already
    // follows.
    if (!boardMembership) {
      throw Errors.CARD_NOT_FOUND;
    }

    // The transcript is about to be posted as a comment, so the bar is the bar
    // for commenting. Someone who could not send the message has no business
    // spending a transcription on it.
    if (boardMembership.role !== BoardMembership.Roles.EDITOR && !boardMembership.canComment) {
      throw Errors.NOT_ENOUGH_RIGHTS;
    }

    const startedAt = Date.now();

    let result;
    try {
      result = await sails.helpers.voice.transcribe.with({
        audio,
        mimeType,
        language: inputs.language,
      });
    } catch (error) {
      if (error instanceof VoiceRequestError) {
        throw { invalidRecording: error.message };
      }

      if (error instanceof VoiceProviderError) {
        sails.log.error(
          `Voice transcription refused by ${error.provider} with status ${error.statusCode}: ${error.body}`,
        );

        if (error.statusCode === 429) {
          // Fixed copy rather than the upstream body: it is a vendor's error
          // page, unbounded in content, and the log line above has it.
          throw {
            transcriptionFailed:
              'The transcription service is busy right now; please try again in a moment',
          };
        }

        if ([400, 413, 415].includes(error.statusCode)) {
          throw {
            invalidRecording: 'That recording could not be transcribed; try recording it again',
          };
        }

        throw { transcriptionFailed: 'The transcription service rejected the request' };
      }

      // A transport failure's message is the dialled URL, which would put the
      // vendor's hostname and the whole query string in front of the user.
      sails.log.error(`Voice transcription failed: ${error.message}`);

      throw {
        transcriptionFailed: 'The recording could not be transcribed right now; please try again',
      };
    }

    // One summary line per transcription: this endpoint is metered per audio
    // minute, so it is the per-user cost record. Note what is NOT here — the
    // transcript. Its LENGTH is the useful signal; its content is the user's
    // own message and has no business in a log file.
    sails.log.info(
      `Voice transcription: card=${card.id} user=${currentUser.id} provider=${stt.provider} ` +
        `mimeType=${mimeType} languages=[${result.languages.join(',')}] ` +
        `audioSeconds=${result.durationSec} transcriptChars=${[...result.text].length} ` +
        `elapsedMs=${Date.now() - startedAt}`,
    );

    return {
      item: {
        text: result.text,
        languages: result.languages,
        durationSec: result.durationSec,
        confidence: result.confidence,
      },
    };
  },
};
