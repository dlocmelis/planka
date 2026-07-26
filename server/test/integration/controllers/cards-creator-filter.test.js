const { expect } = require('chai');
const supertest = require('supertest');

const PROJECT_ID = '1826000000000000001';
const BOARD_ID = '1826000000000000002';
const LIST_ID = '1826000000000000003';
const LABEL_ID = '1826000000000000004';

const REQUESTER_USER_ID = '1826000000000000101';
const CREATOR_A_USER_ID = '1826000000000000102';
const CREATOR_B_USER_ID = '1826000000000000103';
const NON_MEMBER_CREATOR_USER_ID = '1826000000000000104';
const CREATED_NOTHING_USER_ID = '1826000000000000105';

const ALPHA_WIDGET_CARD_ID = '1826000000000000201';
const ALPHA_GADGET_CARD_ID = '1826000000000000202';
const BETA_WIDGET_CARD_ID = '1826000000000000203';
const GAMMA_WIDGET_CARD_ID = '1826000000000000204';

// NOTE: `getByEndlessListId` falls back to raw SQL as soon as any filter is given, and
// `sails.sendNativeQuery` is unavailable on the `sails-disk` datastore used by default in
// tests, so this suite only runs when TEST_DATABASE_URL points at a Postgres database
const isNativeQuerySupported = async () => {
  try {
    await sails.sendNativeQuery('SELECT 1', []);
  } catch (error) {
    if (error.code === 'E_NOT_SUPPORTED') {
      return false;
    }

    throw error;
  }

  return true;
};

describe('cards creatorUserIds filter (controller)', function describeCardsCreatorFilter() {
  this.timeout(30000);

  let request;
  let authHeader;

  const getCards = (query) =>
    request.get(`/api/lists/${LIST_ID}/cards`).query(query).set('Authorization', authHeader);

  const idsOf = (res) => res.body.items.map((item) => item.id).sort();

  before(async function beforeCardsCreatorFilter() {
    if (!(await isNativeQuerySupported())) {
      this.skip();
    }

    request = supertest(sails.hooks.http.app);

    await Promise.all(
      [
        [REQUESTER_USER_ID, 'requester'],
        [CREATOR_A_USER_ID, 'creator-a'],
        [CREATOR_B_USER_ID, 'creator-b'],
        [NON_MEMBER_CREATOR_USER_ID, 'non-member-creator'],
        [CREATED_NOTHING_USER_ID, 'created-nothing'],
      ].map(([id, name]) =>
        User.create({
          id,
          email: `${name}@cards-creator-filter.test`,
          username: name.replace(/-/g, '_'),
          role: User.Roles.BOARD_USER,
          name,
        }).fetch(),
      ),
    );

    await Project.create({
      id: PROJECT_ID,
      name: 'Creator filter project',
    }).fetch();

    await Board.create({
      id: BOARD_ID,
      projectId: PROJECT_ID,
      position: 65536,
      name: 'Creator filter board',
    }).fetch();

    // Archive is a non-finite list type, so cards in it are read through `getByEndlessListId`
    await List.create({
      id: LIST_ID,
      boardId: BOARD_ID,
      type: List.Types.ARCHIVE,
      name: 'Creator filter archive',
    }).fetch();

    await Label.create({
      id: LABEL_ID,
      boardId: BOARD_ID,
      position: 65536,
      name: 'Creator filter label',
      color: Label.COLORS[0],
    }).fetch();

    // Only some of the creators are board members: a card's creator may have left the board
    await Promise.all(
      [REQUESTER_USER_ID, CREATOR_A_USER_ID, CREATOR_B_USER_ID, CREATED_NOTHING_USER_ID].map(
        (userId) =>
          BoardMembership.create({
            projectId: PROJECT_ID,
            boardId: BOARD_ID,
            userId,
            role: BoardMembership.Roles.EDITOR,
          }).fetch(),
      ),
    );

    await Promise.all(
      [
        [ALPHA_WIDGET_CARD_ID, CREATOR_A_USER_ID, 'Alpha widget'],
        [ALPHA_GADGET_CARD_ID, CREATOR_A_USER_ID, 'Alpha gadget'],
        [BETA_WIDGET_CARD_ID, CREATOR_B_USER_ID, 'Beta widget'],
        [GAMMA_WIDGET_CARD_ID, NON_MEMBER_CREATOR_USER_ID, 'Gamma widget'],
      ].map(([id, creatorUserId, name], index) =>
        Card.create({
          id,
          boardId: BOARD_ID,
          listId: LIST_ID,
          creatorUserId,
          type: Card.Types.PROJECT,
          position: (index + 1) * 65536,
          name,
          listChangedAt: new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
        }).fetch(),
      ),
    );

    await CardLabel.create({
      cardId: ALPHA_GADGET_CARD_ID,
      labelId: LABEL_ID,
    }).fetch();

    const { token } = sails.helpers.utils.createJwtToken(REQUESTER_USER_ID);

    await Session.qm.createOne({
      accessToken: token,
      userId: REQUESTER_USER_ID,
      remoteAddress: '127.0.0.1',
    });

    authHeader = `Bearer ${token}`;
  });

  after(async () => {
    if (!request) {
      return;
    }

    // Keep the suite re-runnable against a persistent database
    await CardLabel.destroy({ labelId: LABEL_ID });
    await Card.destroy({ listId: LIST_ID });
    await Label.destroy({ boardId: BOARD_ID });
    await BoardMembership.destroy({ boardId: BOARD_ID });
    await List.destroy({ boardId: BOARD_ID });
    await Board.destroy({ id: BOARD_ID });
    await Project.destroy({ id: PROJECT_ID });
    await Session.destroy({ userId: REQUESTER_USER_ID });
    await User.destroy({
      id: [
        REQUESTER_USER_ID,
        CREATOR_A_USER_ID,
        CREATOR_B_USER_ID,
        NON_MEMBER_CREATOR_USER_ID,
        CREATED_NOTHING_USER_ID,
      ],
    });
  });

  it('returns only the cards created by the given user', async () => {
    const res = await getCards({ creatorUserIds: CREATOR_A_USER_ID });

    expect(res.status).to.equal(200);
    expect(idsOf(res)).to.deep.equal([ALPHA_WIDGET_CARD_ID, ALPHA_GADGET_CARD_ID].sort());
  });

  it('returns the union for several comma-separated creators', async () => {
    const res = await getCards({
      creatorUserIds: `${CREATOR_A_USER_ID},${CREATOR_B_USER_ID}`,
    });

    expect(res.status).to.equal(200);
    expect(idsOf(res)).to.deep.equal(
      [ALPHA_WIDGET_CARD_ID, ALPHA_GADGET_CARD_ID, BETA_WIDGET_CARD_ID].sort(),
    );
  });

  it('returns no items for a creator that created nothing', async () => {
    const res = await getCards({ creatorUserIds: CREATED_NOTHING_USER_ID });

    expect(res.status).to.equal(200);
    expect(res.body.items).to.deep.equal([]);
  });

  it('matches a creator who is not a board member', async () => {
    const res = await getCards({ creatorUserIds: NON_MEMBER_CREATOR_USER_ID });

    expect(res.status).to.equal(200);
    expect(idsOf(res)).to.deep.equal([GAMMA_WIDGET_CARD_ID]);
  });

  it('intersects with labelIds', async () => {
    const res = await getCards({
      creatorUserIds: CREATOR_A_USER_ID,
      labelIds: LABEL_ID,
    });

    expect(res.status).to.equal(200);
    expect(idsOf(res)).to.deep.equal([ALPHA_GADGET_CARD_ID]);

    const otherRes = await getCards({
      creatorUserIds: CREATOR_B_USER_ID,
      labelIds: LABEL_ID,
    });

    expect(otherRes.status).to.equal(200);
    expect(otherRes.body.items).to.deep.equal([]);
  });

  it('intersects with search', async () => {
    const res = await getCards({
      creatorUserIds: CREATOR_A_USER_ID,
      search: 'widget',
    });

    expect(res.status).to.equal(200);
    expect(idsOf(res)).to.deep.equal([ALPHA_WIDGET_CARD_ID]);
  });

  it('returns every card in the list when creatorUserIds is omitted', async () => {
    const res = await getCards({});

    expect(res.status).to.equal(200);
    expect(res.body.items.map((item) => item.id)).to.deep.equal([
      GAMMA_WIDGET_CARD_ID,
      BETA_WIDGET_CARD_ID,
      ALPHA_GADGET_CARD_ID,
      ALPHA_WIDGET_CARD_ID,
    ]);

    // The unfiltered response must still come from the untouched query-builder branch
    const cards = await Card.qm.getByEndlessListId(LIST_ID, {});
    expect(sails.helpers.utils.mapRecords(cards)).to.deep.equal(
      res.body.items.map((item) => item.id),
    );

    expect(Object.keys(res.body).sort()).to.deep.equal(['included', 'items']);
    expect(Object.keys(res.body.included).sort()).to.deep.equal([
      'attachments',
      'cardLabels',
      'cardMemberships',
      'customFieldGroups',
      'customFieldValues',
      'customFields',
      'taskLists',
      'tasks',
      'users',
    ]);
  });

  it('rejects creatorUserIds that are not plain ids', async () => {
    const res = await getCards({ creatorUserIds: `${CREATOR_A_USER_ID}' OR '1'='1` });

    expect(res.status).to.equal(400);
  });

  it('returns no items for an empty creatorUserIds array', async () => {
    const cards = await Card.qm.getByEndlessListId(LIST_ID, { creatorUserIds: [] });

    expect(cards).to.deep.equal([]);
  });
});
