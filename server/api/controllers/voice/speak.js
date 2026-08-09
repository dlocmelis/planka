/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /cards/{cardId}/voice/speech:
 *   post:
 *     summary: Read a message aloud
 *     description: >
 *       Synthesizes speech for one message of the planka_bot conversation on a
 *       card and answers with the audio, base64-encoded. Requires whatever it
 *       takes to READ the thread — admin, or manager of the project, or member
 *       of the board — which is the bar GET /cards/{cardId}/comments applies.
 *       The text comes from the CLIENT rather than from stored history: the
 *       panel already holds the markdown it rendered, and the card only ties
 *       the spend to a conversation the caller can actually see.
 *     tags:
 *       - Voice
 *     operationId: speakMessage
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
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *                 description: The message, as raw markdown; the server prepares it for speech
 *               language:
 *                 type: string
 *                 description: Language hint, a BCP-47 code; picks the pinned voice for it
 *                 example: ru
 *               voice:
 *                 type: string
 *                 description: >
 *                   A voice id previously answered by this endpoint, sent back so a
 *                   conversation keeps one voice
 *     responses:
 *       200:
 *         description: Speech synthesized successfully
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
 *                     - data
 *                     - mimeType
 *                     - voice
 *                   properties:
 *                     data:
 *                       type: string
 *                       description: The audio, base64-encoded
 *                     mimeType:
 *                       type: string
 *                       example: audio/mpeg
 *                     voice:
 *                       type: string
 *                       description: The voice that read it, to send back on the next message
 *                     language:
 *                       type: string
 *                       nullable: true
 *                       description: >
 *                         The language the voice was resolved for, or null when none was.
 *                         Null means "nothing was decided" — a voice reported without one
 *                         is the deployment's default and must not be pinned onto the rest
 *                         of a conversation.
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
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
const { VoiceProviderError, VoiceRequestError } = require('../../../utils/voice');

const Errors = {
  CARD_NOT_FOUND: {
    cardNotFound: 'Card not found',
  },
  NOT_CONFIGURED: {
    notConfigured: 'Text-to-speech is not configured on this server',
  },
  CANNOT_SPEAK: {
    cannotSpeak: 'That message cannot be read aloud',
  },
  SPEECH_FAILED: {
    speechFailed: 'Speech synthesis failed',
  },
};

module.exports = {
  inputs: {
    cardId: {
      ...idInput,
      required: true,
    },
    text: {
      type: 'string',
      required: true,
      // The real ceiling is voiceTtsMaxChars, enforced in the helper against
      // the code-point count so the number in the message is the number the
      // provider would have measured. This only bounds what is parsed.
      //
      // 128 KiB of UTF-16 units is roughly three hours of speech and about
      // sixty times the default character cap — high enough that no plausible
      // VOICE_TTS_MAX_CHARS reaches it, low enough that a body written to make
      // this endpoint work is refused before anything walks it.
      maxLength: 128 * 1024,
    },
    language: {
      type: 'string',
      maxLength: 32,
      allowNull: true,
    },
    voice: {
      type: 'string',
      maxLength: 64,
      allowNull: true,
    },
  },

  exits: {
    cardNotFound: {
      responseType: 'notFound',
    },
    notConfigured: {
      responseType: 'serviceUnavailable',
    },
    cannotSpeak: {
      responseType: 'unprocessableEntity',
    },
    speechFailed: {
      responseType: 'badGateway',
    },
  },

  async fn(inputs) {
    const { currentUser } = this.req;

    const { tts } = sails.helpers.voice.getConfig();

    if (!tts) {
      throw Errors.NOT_CONFIGURED;
    }

    const { card, board, project } = await sails.helpers.cards
      .getPathToProjectById(inputs.cardId)
      .intercept('pathNotFound', () => Errors.CARD_NOT_FOUND);

    // Whoever may READ the thread may hear it, and reading it is not the same
    // question as commenting on it — commenting is gated where it happens, on
    // the comment endpoint and on transcription, which produces one.
    //
    // So this is the read bar VERBATIM, the one `controllers/comments/index.js`
    // and `controllers/cards/show.js` use: an admin, or a manager of the
    // project, or a member of the board. Membership alone would 404 an admin
    // who can see every word of the conversation on screen.
    if (currentUser.role !== User.Roles.ADMIN || project.ownerProjectManagerId) {
      const isProjectManager = await sails.helpers.users.isProjectManager(
        currentUser.id,
        project.id,
      );

      if (!isProjectManager) {
        const boardMembership = await BoardMembership.qm.getOneByBoardIdAndUserId(
          board.id,
          currentUser.id,
        );

        // A card that does not exist and one on a board the caller cannot see
        // are the same 404, which is the rule the read endpoints follow.
        if (!boardMembership) {
          throw Errors.CARD_NOT_FOUND;
        }
      }
    }

    const startedAt = Date.now();

    let result;
    try {
      result = await sails.helpers.voice.synthesize.with({
        text: inputs.text,
        language: inputs.language,
        voice: inputs.voice,
      });
    } catch (error) {
      if (error instanceof VoiceRequestError) {
        throw { cannotSpeak: error.message };
      }

      if (error instanceof VoiceProviderError) {
        sails.log.error(
          `Voice synthesis refused by ${error.provider} with status ${error.statusCode}: ${error.body}`,
        );

        if (error.statusCode === 429) {
          throw {
            speechFailed: 'The speech service is busy right now; please try again in a moment',
          };
        }

        throw { speechFailed: 'The speech service rejected the request' };
      }

      sails.log.error(`Voice synthesis failed: ${error.message}`);

      throw { speechFailed: 'That message could not be read aloud right now; please try again' };
    }

    // Metered per character, so this is the per-user cost record. The message
    // itself is not in it — only how much of it was spoken.
    sails.log.info(
      `Voice synthesis: card=${card.id} user=${currentUser.id} provider=${tts.provider} ` +
        `voice=${result.voice} voiceSource=${result.voiceSource} language=${result.language || '-'} ` +
        `chars=${result.chars} audioBytes=${result.audio.length} ` +
        `elapsedMs=${Date.now() - startedAt}`,
    );

    return {
      item: {
        data: result.audio.toString('base64'),
        mimeType: result.contentType,
        voice: result.voice,
        language: result.language,
      },
    };
  },
};
