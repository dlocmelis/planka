const { expect } = require('chai');
const supertest = require('supertest');

const PROJECT_ID = '1871148607130800001';
const BOARD_ID = '1871148607130800002';
const OTHER_BOARD_ID = '1871148607130800003';

const MEMBER_USER_ID = '1871148607130800101';
const OUTSIDER_USER_ID = '1871148607130800102';

const CARD_A_ID = '1871148607130800201';
const CARD_B_ID = '1871148607130800202';

const LIST_ID = '1871148607130800501';
const BUG_LABEL_ID = '1871148607130800502';
const UI_LABEL_ID = '1871148607130800503';
const FIELD_GROUP_ID = '1871148607130800504';
const COST_FIELD_ID = '1871148607130800505';

const MEMBER_KEY = 'stats-member@pipeline-statistics.test';
const REPORTER_KEY = 'den@setlfi.com';

const HOUR = 60 * 60 * 1000;

// NOTE: sails-disk (used in tests) generates numeric ids that never match
// id-based queries, so every record gets an explicit string id
let nextActionSerial = 300;

describe('GET /api/boards/:id/pipeline-statistics (controller)', function describeStatistics() {
  this.timeout(30000);

  let request;
  const authHeaderByName = {};

  const createSession = async (user) => {
    const { token } = sails.helpers.utils.createJwtToken(user.id);

    await Session.qm.createOne({
      accessToken: token,
      userId: user.id,
      remoteAddress: '127.0.0.1',
    });

    return `Bearer ${token}`;
  };

  // The model stamps createdAt on create, so the action's time is set after.
  const createAction = async (boardId, cardId, type, data, hoursAgo) => {
    const id = `1871148607130800${nextActionSerial}`;
    nextActionSerial += 1;

    await Action.create({ id, boardId, cardId, type, data, userId: MEMBER_USER_ID });
    await Action.updateOne({ id }).set({
      createdAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
    });
  };

  const list = (name) => ({ id: name, type: 'active', name });

  const getStatistics = (boardId, authHeader, query = {}) => {
    const req = request.get(`/api/boards/${boardId}/pipeline-statistics`).query(query);

    return authHeader ? req.set('Authorization', authHeader) : req;
  };

  const cardRecords = {
    // A: a support ticket, its reporter named in the header; a bug, $1.97,
    // 28 hours from entering the board to done.
    [CARD_A_ID]: {
      name: 'Fix the login page',
      description:
        '**Setlfi ticket**\n\nReporter: Deniss Locmelis den@setlfi.com\nType: bug\n\n---\n\nIt fails.',
      labelId: BUG_LABEL_ID,
      cost: '$1.97',
    },
    // B: written on the board by the member; UI, $40.30, 62 days to done.
    [CARD_B_ID]: {
      name: 'Statistics filters',
      description: 'Filter the board flow',
      labelId: UI_LABEL_ID,
      cost: '$40.30',
    },
  };

  const createCard = async (id, index) => {
    const { name, description, labelId, cost } = cardRecords[id];

    await Card.create({
      id,
      boardId: BOARD_ID,
      listId: LIST_ID,
      creatorUserId: MEMBER_USER_ID,
      type: Card.Types.PROJECT,
      position: index + 1,
      name,
      description,
    }).fetch();
    await CardLabel.create({ id: `187114860713080060${index}`, cardId: id, labelId }).fetch();
    await CustomFieldValue.create({
      id: `187114860713080061${index}`,
      cardId: id,
      customFieldGroupId: FIELD_GROUP_ID,
      customFieldId: COST_FIELD_ID,
      content: cost,
    }).fetch();
  };

  const destroyCard = async (id) => {
    await CustomFieldValue.destroy({ cardId: id });
    await CardLabel.destroy({ cardId: id });
    await Card.destroy({ id });
  };

  before(async () => {
    request = supertest(sails.hooks.http.app);

    const [memberUser, outsiderUser] = await Promise.all(
      [
        [MEMBER_USER_ID, 'stats-member'],
        [OUTSIDER_USER_ID, 'stats-outsider'],
      ].map(([id, name]) =>
        User.create({
          id,
          email: `${name}@pipeline-statistics.test`,
          password: 'not-used-in-tests',
          role: User.Roles.BOARD_USER,
          name,
        }).fetch(),
      ),
    );

    await Project.create({ id: PROJECT_ID, name: 'Pipeline statistics project' }).fetch();

    await Promise.all(
      [BOARD_ID, OTHER_BOARD_ID].map((id, index) =>
        Board.create({
          id,
          projectId: PROJECT_ID,
          position: index + 1,
          name: `Statistics board ${index + 1}`,
        }).fetch(),
      ),
    );

    await BoardMembership.create({
      id: '1871148607130800401',
      projectId: PROJECT_ID,
      boardId: BOARD_ID,
      userId: MEMBER_USER_ID,
      role: BoardMembership.Roles.VIEWER,
    }).fetch();

    // A: entered 30 hours ago, deployed and accepted in the last day.
    await createAction(BOARD_ID, CARD_A_ID, 'createCard', { list: list('Backlog') }, 30);
    await createAction(
      BOARD_ID,
      CARD_A_ID,
      'moveCard',
      { fromList: list('In Deployment'), toList: list('Ready for Testing') },
      5,
    );
    await createAction(
      BOARD_ID,
      CARD_A_ID,
      'moveCard',
      { fromList: list('Ready for Testing'), toList: list('Done') },
      2,
    );
    // B: completed in the last day, created 62 days ago — past the read's
    // 60-day reach, so its creation is fetched apart for the time to done.
    await createAction(BOARD_ID, CARD_B_ID, 'createCard', { list: list('Backlog') }, 62 * 24);
    await createAction(
      BOARD_ID,
      CARD_B_ID,
      'moveCard',
      { fromList: list('Ready for Testing'), toList: list('Reopened') },
      3,
    );
    await createAction(
      BOARD_ID,
      CARD_B_ID,
      'moveCard',
      { fromList: list('In Development'), toList: list('Done') },
      1,
    );
    // Another board's move is not this board's flow.
    await createAction(
      OTHER_BOARD_ID,
      CARD_A_ID,
      'moveCard',
      { fromList: list('In Review'), toList: list('Done') },
      1,
    );

    await List.create({
      id: LIST_ID,
      boardId: BOARD_ID,
      type: List.Types.ACTIVE,
      position: 1,
      name: 'Backlog',
    }).fetch();
    await Promise.all(
      [
        [BUG_LABEL_ID, 'bug'],
        [UI_LABEL_ID, 'ui'],
      ].map(([id, name], index) =>
        Label.create({
          id,
          boardId: BOARD_ID,
          position: index + 1,
          name,
          color: 'berry-red',
        }).fetch(),
      ),
    );
    await CustomFieldGroup.create({
      id: FIELD_GROUP_ID,
      boardId: BOARD_ID,
      position: 1,
      name: 'Orchestration',
    }).fetch();
    await CustomField.create({
      id: COST_FIELD_ID,
      customFieldGroupId: FIELD_GROUP_ID,
      position: 1,
      name: 'Est. Cost (USD)',
      showOnFrontOfCard: true,
    }).fetch();
    await Promise.all([CARD_A_ID, CARD_B_ID].map(createCard));

    [authHeaderByName.member, authHeaderByName.outsider] = await Promise.all(
      [memberUser, outsiderUser].map(createSession),
    );
  });

  after(async () => {
    await Promise.all([CARD_A_ID, CARD_B_ID].map(destroyCard));
    await CustomField.destroy({ id: COST_FIELD_ID });
    await CustomFieldGroup.destroy({ id: FIELD_GROUP_ID });
    await Label.destroy({ boardId: BOARD_ID });
    await List.destroy({ id: LIST_ID });
    await Action.destroy({ boardId: [BOARD_ID, OTHER_BOARD_ID] });
    await BoardMembership.destroy({ boardId: BOARD_ID });
    await Board.destroy({ id: [BOARD_ID, OTHER_BOARD_ID] });
    await Project.destroy({ id: PROJECT_ID });
    await Session.destroy({ userId: [MEMBER_USER_ID, OUTSIDER_USER_ID] });
    await User.destroy({ id: [MEMBER_USER_ID, OUTSIDER_USER_ID] });
  });

  it('answers a board member the board flow for 24h, 7d and 30d with the previous periods', async () => {
    const response = await getStatistics(BOARD_ID, authHeaderByName.member);

    expect(response.status).to.equal(200);

    const { item } = response.body;

    expect(item.boardId).to.equal(BOARD_ID);
    expect(item.since).to.be.a('string');
    expect(item.periods.map((period) => period.key)).to.deep.equal(['24h', '7d', '30d']);

    const [day, week, month] = item.periods;

    expect(day.current).to.include({
      entered: 0,
      completed: 2,
      deployed: 1,
      reopened: 1,
      testingSent: 1,
      testingAccepted: 1,
      testingRejected: 1,
      acceptanceRate: 0.5,
      timedToDone: 2,
    });
    expect(day.previous).to.include({ entered: 1, completed: 0 });
    expect(week.current).to.include({ entered: 1, completed: 2 });
    // B's creation lies 62 days back, outside every window, yet it times B.
    expect(month.current).to.include({ entered: 1, timedToDone: 2 });
    expect(month.previous).to.include({ entered: 0 });
    // The history begins with B's creation, before the 30d period's previous
    // window — so the tab has no "since" to warn about.
    expect(Date.parse(item.since)).to.be.below(Date.parse(month.previous.from));
  });

  it('tells somebody who is not a member that the board does not exist', async () => {
    const response = await getStatistics(BOARD_ID, authHeaderByName.outsider);

    expect(response.status).to.equal(404);
    expect(response.body).to.not.have.property('item');
  });

  it('refuses a request with no sign-in', async () => {
    const response = await getStatistics(BOARD_ID);

    expect(response.status).to.equal(401);
  });

  describe('filtered', () => {
    const dayOf = async (query) => {
      const response = await getStatistics(BOARD_ID, authHeaderByName.member, query);

      expect(response.status, JSON.stringify(response.body)).to.equal(200);
      expect(response.body.item.periods.map((period) => period.key)).to.deep.equal([
        '24h',
        '7d',
        '30d',
      ]);

      return response.body.item.periods[0].current;
    };

    // A alone: deployed and accepted, created 30 h ago. B alone: rejected
    // into Reopened, then done.
    const ONLY_A = { completed: 1, deployed: 1, reopened: 0, testingRejected: 0, timedToDone: 1 };
    const ONLY_B = { completed: 1, deployed: 0, reopened: 1, testingRejected: 1, timedToDone: 1 };

    it('lists who created the board cards: the reporter, else the Planka user', async () => {
      const response = await getStatistics(BOARD_ID, authHeaderByName.member);

      expect(response.body.item.filterOptions).to.deep.equal({
        creators: [
          { key: REPORTER_KEY, name: 'Deniss Locmelis', cards: 1 },
          { key: MEMBER_KEY, name: 'stats-member', cards: 1 },
        ],
      });
    });

    it('answers the ids of the cards a card filter matched, and none without one', async () => {
      const cardIdsOf = async (query) => {
        const response = await getStatistics(BOARD_ID, authHeaderByName.member, query);

        expect(response.status, JSON.stringify(response.body)).to.equal(200);

        return response.body.item.cardIds;
      };

      expect(await cardIdsOf({ labelIds: BUG_LABEL_ID })).to.deep.equal([CARD_A_ID]);
      expect(await cardIdsOf({ search: 'filter' })).to.deep.equal([CARD_B_ID]);
      expect(
        (await cardIdsOf({ creators: `${REPORTER_KEY},${MEMBER_KEY}` })).slice().sort(),
      ).to.deep.equal([CARD_A_ID, CARD_B_ID]);
      expect(await cardIdsOf({ costMin: '100' })).to.deep.equal([]);
      // Every card, or only a custom period: there is no card set to send.
      expect(await cardIdsOf({})).to.equal(undefined);
      expect(
        await cardIdsOf({
          from: new Date(Date.now() - 10 * HOUR).toISOString(),
          to: new Date().toISOString(),
        }),
      ).to.equal(undefined);
    });

    it('lists a creator by the header the card has now, once it is edited', async () => {
      const creatorsNow = async () =>
        (await getStatistics(BOARD_ID, authHeaderByName.member)).body.item.filterOptions.creators;

      expect((await creatorsNow()).map((creator) => creator.key)).to.include(MEMBER_KEY);

      await Card.qm.updateOne(
        { id: CARD_B_ID },
        { description: '**Setlfi ticket**\n\nReporter: Jon Snow hq@setlfi.com\n\n---\n\nB' },
      );

      try {
        expect(await creatorsNow()).to.deep.equal([
          { key: REPORTER_KEY, name: 'Deniss Locmelis', cards: 1 },
          { key: 'hq@setlfi.com', name: 'Jon Snow', cards: 1 },
        ]);
      } finally {
        await Card.qm.updateOne(
          { id: CARD_B_ID },
          { description: cardRecords[CARD_B_ID].description },
        );
      }

      expect((await creatorsNow()).map((creator) => creator.key)).to.include(MEMBER_KEY);
    });

    it('counts only the cards with any of the labels', async () => {
      expect(await dayOf({ labelIds: BUG_LABEL_ID })).to.include(ONLY_A);
      expect(await dayOf({ labelIds: UI_LABEL_ID })).to.include(ONLY_B);
      expect(await dayOf({ labelIds: `${BUG_LABEL_ID},${UI_LABEL_ID}` })).to.include({
        completed: 2,
      });
    });

    it('counts only the cards whose name or description holds the keyword', async () => {
      expect(await dayOf({ search: 'LOGIN' })).to.include(ONLY_A);
      expect(await dayOf({ search: 'board flow' })).to.include(ONLY_B);
    });

    it('counts only the cards of any of the creators', async () => {
      expect(await dayOf({ creators: REPORTER_KEY })).to.include(ONLY_A);
      expect(await dayOf({ creators: MEMBER_KEY.toUpperCase() })).to.include(ONLY_B);
    });

    it('counts only the cards whose time to done and cost are in bounds', async () => {
      expect(await dayOf({ durationMax: String(29 * 3600) })).to.include(ONLY_A);
      expect(await dayOf({ durationMin: String(29 * 3600) })).to.include(ONLY_B);
      expect(await dayOf({ costMax: '2' })).to.include(ONLY_A);
      expect(await dayOf({ costMin: '10', costMax: '40.30' })).to.include(ONLY_B);
    });

    it('combines different filters with AND', async () => {
      expect(await dayOf({ labelIds: BUG_LABEL_ID, costMin: '10' })).to.include({
        completed: 0,
        timedToDone: 0,
      });
      expect(await dayOf({ search: 'filter', creators: MEMBER_KEY })).to.include(ONLY_B);
    });

    it('drops a card deleted since, once a card filter is set', async () => {
      await destroyCard(CARD_B_ID);

      try {
        expect(await dayOf({ creators: `${REPORTER_KEY},${MEMBER_KEY}` })).to.include(ONLY_A);
        // Without a card filter, its history still counts, as it did before.
        expect(await dayOf({})).to.include({ completed: 2 });
      } finally {
        await createCard(CARD_B_ID, 1);
      }
    });

    it('counts one custom period against the one of the same length before it', async () => {
      const toMs = Date.now() - 10 * HOUR;
      const fromMs = toMs - 26 * HOUR;
      const response = await getStatistics(BOARD_ID, authHeaderByName.member, {
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
      });

      expect(response.status).to.equal(200);

      const { periods } = response.body.item;

      expect(periods).to.have.length(1);
      expect(periods[0].key).to.equal('custom');
      expect(periods[0].seconds).to.equal(26 * 3600);
      expect(Date.parse(periods[0].current.from)).to.equal(fromMs);
      expect(Date.parse(periods[0].previous.from)).to.equal(fromMs - 26 * HOUR);
      // A entered 30 h ago, inside it; everything else happened after it.
      expect(periods[0].current).to.include({ entered: 1, completed: 0, deployed: 0 });
      expect(periods[0].previous).to.include({ entered: 0, completed: 0 });
    });

    it('refuses a parameter it does not understand with a 400', async () => {
      const queries = [
        { labelIds: 'bug' },
        { durationMin: 'soon' },
        { costMin: '5', costMax: '1' },
        { from: new Date().toISOString() },
        { from: '2026-09-01', to: '2026-09-02' },
      ];

      // eslint-disable-next-line no-restricted-syntax
      for (const query of queries) {
        // eslint-disable-next-line no-await-in-loop
        const response = await getStatistics(BOARD_ID, authHeaderByName.member, query);

        expect(response.status, JSON.stringify(query)).to.equal(400);
        expect(response.body).to.not.have.property('item');
      }
    });

    it('refuses a custom period longer than 366 days', async () => {
      const toMs = Date.now();
      const query = (days) => ({
        from: new Date(toMs - days * 24 * HOUR).toISOString(),
        to: new Date(toMs).toISOString(),
      });

      const tooLong = await getStatistics(BOARD_ID, authHeaderByName.member, query(367));

      expect(tooLong.status).to.equal(400);
      expect(tooLong.body.code).to.equal('E_INVALID_FILTER');
      expect(tooLong.body.message).to.contain('366 days');

      const longest = await getStatistics(BOARD_ID, authHeaderByName.member, query(366));

      expect(longest.status).to.equal(200);
      expect(longest.body.item.periods[0].current).to.include({ entered: 2, completed: 2 });
    });

    it('still tells somebody who is not a member that the board does not exist', async () => {
      const response = await getStatistics(BOARD_ID, authHeaderByName.outsider, {
        search: 'login',
      });

      expect(response.status).to.equal(404);
    });
  });
});
