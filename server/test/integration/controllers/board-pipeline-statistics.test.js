const { expect } = require('chai');
const supertest = require('supertest');

const PROJECT_ID = '1871148607130800001';
const BOARD_ID = '1871148607130800002';
const OTHER_BOARD_ID = '1871148607130800003';

const MEMBER_USER_ID = '1871148607130800101';
const OUTSIDER_USER_ID = '1871148607130800102';

const CARD_A_ID = '1871148607130800201';
const CARD_B_ID = '1871148607130800202';

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

  const getStatistics = (boardId, authHeader) => {
    const req = request.get(`/api/boards/${boardId}/pipeline-statistics`);

    return authHeader ? req.set('Authorization', authHeader) : req;
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

    [authHeaderByName.member, authHeaderByName.outsider] = await Promise.all(
      [memberUser, outsiderUser].map(createSession),
    );
  });

  after(async () => {
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
});
