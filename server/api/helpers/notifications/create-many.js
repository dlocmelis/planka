/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

const escapeMarkdown = require('escape-markdown');
const escapeHtml = require('escape-html');

const { mentionMarkupToText } = require('../../../utils/mentions');
const {
  groupForNotificationType,
  resolveOwnPredicate,
  matchesPreferences,
} = require('../../../utils/notification-preferences');

const buildTitle = (notification, t) => {
  switch (notification.type) {
    case Notification.Types.MOVE_CARD:
      return t('Card Moved');
    case Notification.Types.COMMENT_CARD:
      return t('New Comment');
    case Notification.Types.ADD_MEMBER_TO_CARD:
      return t('You Were Added to Card');
    case Notification.Types.MENTION_IN_COMMENT:
      return t('You Were Mentioned in Comment');
    case Notification.Types.ADD_LABEL_TO_CARD:
      return t('Label Added to Card');
    case Notification.Types.SET_CUSTOM_FIELD_VALUE:
      return t('Custom Field Value Set');
    default:
      return null;
  }
};

const buildBodyByFormat = (board, card, notification, actorUser, t) => {
  const markdownCardLink = `[${escapeMarkdown(card.name)}](${sails.config.custom.baseUrl}/cards/${card.id})`;
  const htmlCardLink = `<a href="${sails.config.custom.baseUrl}/cards/${card.id}">${escapeHtml(card.name)}</a>`;

  switch (notification.type) {
    case Notification.Types.MOVE_CARD: {
      const fromListName = sails.helpers.lists.resolveName(notification.data.fromList, t);
      const toListName = sails.helpers.lists.resolveName(notification.data.toList, t);

      return {
        text: t(
          '%s moved %s from %s to %s on %s',
          actorUser.name,
          card.name,
          fromListName,
          toListName,
          board.name,
        ),
        markdown: t(
          '%s moved %s from %s to %s on %s',
          escapeMarkdown(actorUser.name),
          markdownCardLink,
          `**${escapeMarkdown(fromListName)}**`,
          `**${escapeMarkdown(toListName)}**`,
          escapeMarkdown(board.name),
        ),
        html: t(
          '%s moved %s from %s to %s on %s',
          escapeHtml(actorUser.name),
          htmlCardLink,
          `<b>${escapeHtml(fromListName)}</b>`,
          `<b>${escapeHtml(toListName)}</b>`,
          escapeHtml(board.name),
        ),
      };
    }
    case Notification.Types.COMMENT_CARD: {
      const commentText = _.truncate(mentionMarkupToText(notification.data.text));

      return {
        text: `${t(
          '%s left a new comment to %s on %s',
          actorUser.name,
          card.name,
          board.name,
        )}:\n${commentText}`,
        markdown: `${t(
          '%s left a new comment to %s on %s',
          escapeMarkdown(actorUser.name),
          markdownCardLink,
          escapeMarkdown(board.name),
        )}:\n\n*${escapeMarkdown(commentText)}*`,
        html: `${t(
          '%s left a new comment to %s on %s',
          escapeHtml(actorUser.name),
          htmlCardLink,
          escapeHtml(board.name),
        )}:\n\n<i>${escapeHtml(commentText)}</i>`,
      };
    }
    case Notification.Types.ADD_MEMBER_TO_CARD:
      return {
        text: t('%s added you to %s on %s', actorUser.name, card.name, board.name),
        markdown: t(
          '%s added you to %s on %s',
          escapeMarkdown(actorUser.name),
          markdownCardLink,
          escapeMarkdown(board.name),
        ),
        html: t(
          '%s added you to %s on %s',
          escapeHtml(actorUser.name),
          htmlCardLink,
          escapeHtml(board.name),
        ),
      };
    case Notification.Types.MENTION_IN_COMMENT: {
      const commentText = _.truncate(mentionMarkupToText(notification.data.text));

      return {
        text: `${t(
          '%s mentioned you in %s on %s',
          actorUser.name,
          card.name,
          board.name,
        )}:\n${commentText}`,
        markdown: `${t(
          '%s mentioned you in %s on %s',
          escapeMarkdown(actorUser.name),
          markdownCardLink,
          escapeMarkdown(board.name),
        )}:\n\n*${escapeMarkdown(commentText)}*`,
        html: `${t(
          '%s mentioned you in %s on %s',
          escapeHtml(actorUser.name),
          htmlCardLink,
          escapeHtml(board.name),
        )}:\n\n<i>${escapeHtml(commentText)}</i>`,
      };
    }
    case Notification.Types.ADD_LABEL_TO_CARD: {
      const labelName = notification.data.label.name || notification.data.label.color;

      return {
        text: t('%s added label %s to %s on %s', actorUser.name, labelName, card.name, board.name),
        markdown: t(
          '%s added label %s to %s on %s',
          escapeMarkdown(actorUser.name),
          `**${escapeMarkdown(labelName)}**`,
          markdownCardLink,
          escapeMarkdown(board.name),
        ),
        html: t(
          '%s added label %s to %s on %s',
          escapeHtml(actorUser.name),
          `<b>${escapeHtml(labelName)}</b>`,
          htmlCardLink,
          escapeHtml(board.name),
        ),
      };
    }
    case Notification.Types.SET_CUSTOM_FIELD_VALUE:
      return {
        text: t(
          '%s set %s to %s for %s on %s',
          actorUser.name,
          notification.data.customField.name,
          notification.data.value,
          card.name,
          board.name,
        ),
        markdown: t(
          '%s set %s to %s for %s on %s',
          escapeMarkdown(actorUser.name),
          `**${escapeMarkdown(notification.data.customField.name)}**`,
          `**${escapeMarkdown(notification.data.value)}**`,
          markdownCardLink,
          escapeMarkdown(board.name),
        ),
        html: t(
          '%s set %s to %s for %s on %s',
          escapeHtml(actorUser.name),
          `<b>${escapeHtml(notification.data.customField.name)}</b>`,
          `<b>${escapeHtml(notification.data.value)}</b>`,
          htmlCardLink,
          escapeHtml(board.name),
        ),
      };
    default:
      return null;
  }
};

const buildAndSendNotifications = async (services, board, card, notification, actorUser, t) => {
  await sails.helpers.utils.sendNotifications(
    services,
    buildTitle(notification, t),
    buildBodyByFormat(board, card, notification, actorUser, t),
  );
};

// TODO: use templates (views) to build html
const buildEmail = (board, card, notification, actorUser, notifiableUser, t) => {
  const cardLink = `<a href="${sails.config.custom.baseUrl}/cards/${card.id}">${escapeHtml(card.name)}</a>`;
  const boardLink = `<a href="${sails.config.custom.baseUrl}/boards/${board.id}">${escapeHtml(board.name)}</a>`;

  let html;
  switch (notification.type) {
    case Notification.Types.MOVE_CARD: {
      const fromListName = sails.helpers.lists.resolveName(notification.data.fromList, t);
      const toListName = sails.helpers.lists.resolveName(notification.data.toList, t);

      html = `<p>${t(
        '%s moved %s from %s to %s on %s',
        escapeHtml(actorUser.name),
        cardLink,
        escapeHtml(fromListName),
        escapeHtml(toListName),
        boardLink,
      )}</p>`;

      break;
    }
    case Notification.Types.COMMENT_CARD:
      html = `<p>${t(
        '%s left a new comment to %s on %s',
        escapeHtml(actorUser.name),
        cardLink,
        boardLink,
      )}</p><p>${escapeHtml(mentionMarkupToText(notification.data.text))}</p>`;

      break;
    case Notification.Types.ADD_MEMBER_TO_CARD:
      html = `<p>${t(
        '%s added you to %s on %s',
        escapeHtml(actorUser.name),
        cardLink,
        boardLink,
      )}</p>`;

      break;
    case Notification.Types.MENTION_IN_COMMENT:
      html = `<p>${t(
        '%s mentioned you in %s on %s',
        escapeHtml(actorUser.name),
        cardLink,
        boardLink,
      )}</p><p>${escapeHtml(mentionMarkupToText(notification.data.text))}</p>`;

      break;
    case Notification.Types.ADD_LABEL_TO_CARD: {
      const labelName = notification.data.label.name || notification.data.label.color;

      html = `<p>${t(
        '%s added label %s to %s on %s',
        escapeHtml(actorUser.name),
        escapeHtml(labelName),
        cardLink,
        boardLink,
      )}</p>`;

      break;
    }
    case Notification.Types.SET_CUSTOM_FIELD_VALUE:
      html = `<p>${t(
        '%s set %s to %s for %s on %s',
        escapeHtml(actorUser.name),
        escapeHtml(notification.data.customField.name),
        escapeHtml(notification.data.value),
        cardLink,
        boardLink,
      )}</p>`;

      break;
    default:
      return null; // TODO: throw error?
  }

  return {
    html,
    to: notifiableUser.email,
    subject: buildTitle(notification, t),
  };
};

const sendEmails = async (transporter, emails) => {
  await Promise.all(
    emails.map((email) =>
      sails.helpers.utils.sendEmail.with({
        ...email,
        transporter,
      }),
    ),
  );

  transporter.close();
};

module.exports = {
  inputs: {
    arrayOfValues: {
      type: 'ref',
      required: true,
    },
    project: {
      type: 'ref',
      required: true,
    },
    board: {
      type: 'ref',
      required: true,
    },
    list: {
      type: 'ref',
      required: true,
    },
    webhooks: {
      type: 'ref',
      required: true,
    },
  },

  async fn(inputs) {
    const { arrayOfValues } = inputs;

    // Drop recipients whose notificationEvents preferences mute their notification type:
    // no DB row, socket broadcast, webhook, push or email (all happen below)
    const filterableUserIds = _.uniq(
      arrayOfValues
        .filter((values) => groupForNotificationType(values.type))
        .map((values) => values.userId),
    );

    let recipientsById = {};

    if (filterableUserIds.length > 0) {
      const recipients = await User.qm.getByIds(filterableUserIds);
      recipientsById = _.keyBy(recipients, 'id');
    }

    // Cache promises so concurrent entries for the same card share a single query
    const cardMembershipsByCardId = {};

    const getCardMemberships = (cardId) => {
      if (!cardMembershipsByCardId[cardId]) {
        cardMembershipsByCardId[cardId] = CardMembership.qm.getByCardId(cardId);
      }

      return cardMembershipsByCardId[cardId];
    };

    const keepFlags = await Promise.all(
      arrayOfValues.map(async (values) => {
        if (!groupForNotificationType(values.type)) {
          return true;
        }

        const recipient = recipientsById[values.userId];

        if (!recipient) {
          return true; // Fail open when the recipient record is missing
        }

        const cardMemberships = await getCardMemberships(values.card.id);

        const own = resolveOwnPredicate(cardMemberships, values.card.creatorUserId, values.userId);
        const dev = !!values.creatorUser.isBot;

        return matchesPreferences(recipient.notificationEvents, values.type, { own, dev });
      }),
    );

    const filteredArrayOfValues = arrayOfValues.filter((values, index) => keepFlags[index]);

    if (filteredArrayOfValues.length === 0) {
      return [];
    }

    const ids = await sails.helpers.utils.generateIds(filteredArrayOfValues.length);
    const valuesById = {};

    const notifications = await Notification.qm.create(
      filteredArrayOfValues.map((values) => {
        const id = ids.shift();

        const nextValues = {
          ...values,
          id,
          creatorUserId: values.creatorUser.id,
          boardId: values.card.boardId,
          cardId: values.card.id,
        };
        if (values.comment) {
          nextValues.commentId = values.comment.id;
        }
        if (values.action) {
          nextValues.actionId = values.action.id;
        }

        valuesById[id] = { ...nextValues }; // FIXME: hack
        return nextValues;
      }),
    );

    notifications.forEach((notification) => {
      const values = valuesById[notification.id];

      sails.sockets.broadcast(`user:${notification.userId}`, 'notificationCreate', {
        item: notification,
        included: {
          users: [sails.helpers.users.presentOne(values.creatorUser, {})], // FIXME: hack
        },
      });

      sails.helpers.utils.sendWebhooks.with({
        webhooks: inputs.webhooks,
        event: Webhook.Events.NOTIFICATION_CREATE,
        buildData: () => ({
          item: notification,
          included: {
            projects: [inputs.project],
            boards: [inputs.board],
            lists: [inputs.list],
            cards: [values.card],
            ...(notification.commentId
              ? {
                  comments: [values.comment],
                }
              : {
                  actions: [values.action],
                }),
          },
        }),
        user: values.creatorUser,
      });
    });

    const notificationsByUserId = _.groupBy(notifications, 'userId');

    const notifiableUsers = await User.qm.getByIds(Object.keys(notificationsByUserId), {
      withDeactivated: false,
    });

    if (notifiableUsers.length > 0) {
      const notifiableUserIds = sails.helpers.utils.mapRecords(notifiableUsers);

      const notificationServices = await NotificationService.qm.getByUserIds(notifiableUserIds);
      const { transporter } = await sails.helpers.utils.makeSmtpTransporter();

      if (notificationServices.length > 0 || transporter) {
        const notificationServicesByUserId = _.groupBy(notificationServices, 'userId');

        notifiableUsers.forEach(async (notifiableUser) => {
          const t = sails.helpers.utils.makeTranslator(notifiableUser.language);

          const emails = notificationsByUserId[notifiableUser.id].flatMap((notification) => {
            const values = valuesById[notification.id];

            if (notificationServicesByUserId[notifiableUser.id]) {
              const services = notificationServicesByUserId[notifiableUser.id].map(
                (notificationService) => _.pick(notificationService, ['url', 'format']),
              );

              buildAndSendNotifications(
                services,
                inputs.board,
                values.card,
                notification,
                values.creatorUser,
                t,
              );
            }

            if (transporter) {
              return buildEmail(
                inputs.board,
                values.card,
                notification,
                values.creatorUser,
                notifiableUser,
                t,
              );
            }

            return [];
          });

          if (emails.length > 0) {
            sendEmails(transporter, emails);
          }
        });
      }
    }

    return notifications;
  },
};
