/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * PushSubscription.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     PushSubscription:
 *       type: object
 *       required:
 *         - id
 *         - userId
 *         - endpoint
 *         - keysP256dh
 *         - keysAuth
 *         - createdAt
 *         - updatedAt
 *       properties:
 *         id:
 *           type: string
 *           description: Unique identifier for the push subscription
 *           example: "1357158568008091264"
 *         userId:
 *           type: string
 *           description: ID of the user the subscription is associated with
 *           example: "1357158568008091265"
 *         endpoint:
 *           type: string
 *           description: Push service endpoint URL
 *           example: https://push.service.example.com/subscription/abc123
 *         keysP256dh:
 *           type: string
 *           description: P-256 ECDH public key used for payload encryption
 *           example: BOr4lZv5y0lZHZ5ZzN6fQ3F0dW...
 *         keysAuth:
 *           type: string
 *           description: Auth secret used for payload encryption
 *           example: dGVzdGF1dGhzZWNyZXQ...
 *         userAgent:
 *           type: string
 *           nullable: true
 *           description: User agent of the browser that created the subscription
 *           example: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36
 *         createdAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: When the push subscription was created
 *           example: 2024-01-01T00:00:00.000Z
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: When the push subscription was last updated
 *           example: 2024-01-01T00:00:00.000Z
 *         lastUsedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: When a push notification was last sent to the subscription
 *           example: 2024-01-01T00:00:00.000Z
 *         disabledAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: When the push subscription was disabled (e.g. after a 404/410 response)
 *           example: 2024-01-01T00:00:00.000Z
 */

module.exports = {
  attributes: {
    //  ╔═╗╦═╗╦╔╦╗╦╔╦╗╦╦  ╦╔═╗╔═╗
    //  ╠═╝╠╦╝║║║║║ ║ ║╚╗╔╝║╣ ╚═╗
    //  ╩  ╩╚═╩╩ ╩╩ ╩ ╩ ╚╝ ╚═╝╚═╝

    endpoint: {
      type: 'string',
      required: true,
    },
    keysP256dh: {
      type: 'string',
      required: true,
      columnName: 'keys_p256dh',
    },
    keysAuth: {
      type: 'string',
      required: true,
      columnName: 'keys_auth',
    },
    userAgent: {
      type: 'string',
      allowNull: true,
      columnName: 'user_agent',
    },
    lastUsedAt: {
      type: 'ref',
      columnName: 'last_used_at',
    },
    disabledAt: {
      type: 'ref',
      columnName: 'disabled_at',
    },

    //  ╔═╗╔╦╗╔╗ ╔═╗╔╦╗╔═╗
    //  ║╣ ║║║╠╩╗║╣  ║║╚═╗
    //  ╚═╝╩ ╩╚═╝╚═╝═╩╝╚═╝

    //  ╔═╗╔═╗╔═╗╔═╗╔═╗╦╔═╗╔╦╗╦╔═╗╔╗╔╔═╗
    //  ╠═╣╚═╗╚═╗║ ║║  ║╠═╣ ║ ║║ ║║║║╚═╗
    //  ╩ ╩╚═╝╚═╝╚═╝╚═╝╩╩ ╩ ╩ ╩╚═╝╝╚╝╚═╝

    userId: {
      model: 'User',
      columnName: 'user_id',
    },
  },

  tableName: 'push_subscription',
};
