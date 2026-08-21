const { expect } = require('chai');
const supertest = require('supertest');

describe('Card dependencies', function describeCardDependencies() {
  this.timeout(30000);

  let request;
  let project;
  let sprintBoard;
  let requestsBoard;
  let sprintList;
  let requestsList;
  let cardA;
  let cardB;
  let cardC;
  let foreignProject;
  let foreignBoard;
  let foreignList;
  let foreignCard;
  let editor;
  let viewer;
  let outsider;

  const tokens = {};
  const broadcasts = [];

  let originalBroadcast;
  let nextId = 1000;

  const id = () => {
    nextId += 1;
    return `18254765048852${nextId}`;
  };

  const mintAccessToken = async (user) => {
    const { token } = sails.helpers.utils.createJwtToken(user.id);

    await sails.helpers.sessions.createOne.with({
      values: {
        accessToken: token,
        userId: user.id,
        remoteAddress: '127.0.0.1',
        userAgent: 'mocha',
      },
    });

    return token;
  };

  const createDependency = (token, cardId, dependsOnCardId) =>
    request
      .post(`/api/cards/${cardId}/card-dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dependsOnCardId });

  const deleteDependency = (token, cardId, dependsOnCardId) =>
    request
      .delete(`/api/cards/${cardId}/card-dependencies/dependsOnCardId:${dependsOnCardId}`)
      .set('Authorization', `Bearer ${token}`);

  const getDependencies = (token, cardId) =>
    request.get(`/api/cards/${cardId}/card-dependencies`).set('Authorization', `Bearer ${token}`);

  const dependencyBroadcastsTo = (room, event) =>
    broadcasts.filter(([roomName, eventName]) => roomName === room && eventName === event);

  before(async () => {
    request = supertest(sails.hooks.http.app);

    originalBroadcast = sails.sockets.broadcast;
    sails.sockets.broadcast = (...args) => {
      broadcasts.push(args);
      return originalBroadcast(...args);
    };

    project = await Project.create({ id: id(), name: 'Dependencies Project' }).fetch();

    sprintBoard = await Board.create({
      id: id(),
      projectId: project.id,
      position: 1,
      name: 'Sprint Board',
    }).fetch();

    requestsBoard = await Board.create({
      id: id(),
      projectId: project.id,
      position: 2,
      name: 'Setlfi User Requests',
    }).fetch();

    sprintList = await List.create({
      id: id(),
      boardId: sprintBoard.id,
      type: List.Types.ACTIVE,
      position: 65536,
      name: 'Backlog',
    }).fetch();

    requestsList = await List.create({
      id: id(),
      boardId: requestsBoard.id,
      type: List.Types.ACTIVE,
      position: 65536,
      name: 'Backlog',
    }).fetch();

    foreignProject = await Project.create({ id: id(), name: 'Someone Else' }).fetch();

    foreignBoard = await Board.create({
      id: id(),
      projectId: foreignProject.id,
      position: 1,
      name: 'Private Board',
    }).fetch();

    foreignList = await List.create({
      id: id(),
      boardId: foreignBoard.id,
      type: List.Types.ACTIVE,
      position: 65536,
      name: 'Backlog',
    }).fetch();

    [editor, viewer, outsider] = await Promise.all(
      ['dep-editor', 'dep-viewer', 'dep-outsider'].map((name) =>
        User.create({
          id: id(),
          email: `${name}@example.com`,
          username: name,
          role: User.Roles.BOARD_USER,
          name,
        }).fetch(),
      ),
    );

    await Promise.all(
      [sprintBoard, requestsBoard].map((board) =>
        BoardMembership.create({
          projectId: project.id,
          boardId: board.id,
          userId: editor.id,
          role: BoardMembership.Roles.EDITOR,
        }).fetch(),
      ),
    );

    await BoardMembership.create({
      projectId: project.id,
      boardId: sprintBoard.id,
      userId: viewer.id,
      role: BoardMembership.Roles.VIEWER,
    }).fetch();

    tokens.editor = await mintAccessToken(editor);
    tokens.viewer = await mintAccessToken(viewer);
    tokens.outsider = await mintAccessToken(outsider);

    [cardA, cardB, cardC] = await Promise.all(
      ['Card A', 'Card B', 'Card C'].map((name) =>
        Card.create({
          id: id(),
          boardId: sprintBoard.id,
          listId: sprintList.id,
          creatorUserId: editor.id,
          type: Card.Types.PROJECT,
          position: 65536,
          name,
        }).fetch(),
      ),
    );

    foreignCard = await Card.create({
      id: id(),
      boardId: foreignBoard.id,
      listId: foreignList.id,
      creatorUserId: outsider.id,
      type: Card.Types.PROJECT,
      position: 65536,
      name: 'Somebody else’s card',
    }).fetch();
  });

  after(() => {
    sails.sockets.broadcast = originalBroadcast;
  });

  beforeEach(() => {
    broadcasts.length = 0;
  });

  it('marks a card as dependent on another card', async () => {
    const res = await createDependency(tokens.editor, cardA.id, cardB.id);

    expect(res.status).to.equal(200);
    expect(res.body.item.cardId).to.equal(cardA.id);
    expect(res.body.item.dependsOnCardId).to.equal(cardB.id);

    const stored = await CardDependency.qm.getOneByCardIdAndDependsOnCardId(cardA.id, cardB.id);
    expect(stored).to.be.an('object');

    expect(
      dependencyBroadcastsTo(`board:${sprintBoard.id}`, 'cardDependencyCreate'),
    ).to.have.lengthOf(1);
  });

  it('refuses the same dependency twice', async () => {
    const res = await createDependency(tokens.editor, cardA.id, cardB.id);

    expect(res.status).to.equal(409);
  });

  it('refuses a card that depends on itself', async () => {
    const res = await createDependency(tokens.editor, cardA.id, cardA.id);

    expect(res.status).to.equal(422);
  });

  it('refuses a dependency that would close a cycle', async () => {
    // A already waits for B; B waiting for A would deadlock both of them.
    const direct = await createDependency(tokens.editor, cardB.id, cardA.id);
    expect(direct.status).to.equal(422);

    // ...and so would the same loop taken the long way round: B → C → A.
    const throughC = await createDependency(tokens.editor, cardB.id, cardC.id);
    expect(throughC.status).to.equal(200);

    const closing = await createDependency(tokens.editor, cardC.id, cardA.id);
    expect(closing.status).to.equal(422);

    await deleteDependency(tokens.editor, cardB.id, cardC.id);
  });

  it('allows a dependency across boards', async () => {
    const requestCard = await Card.create({
      id: id(),
      boardId: requestsBoard.id,
      listId: requestsList.id,
      creatorUserId: editor.id,
      type: Card.Types.PROJECT,
      position: 65536,
      name: 'User request',
    }).fetch();

    const res = await createDependency(tokens.editor, requestCard.id, cardB.id);

    expect(res.status).to.equal(200);

    // Both boards hear about it: the waiting card's and the blocker's.
    expect(
      dependencyBroadcastsTo(`board:${requestsBoard.id}`, 'cardDependencyCreate'),
    ).to.have.lengthOf(1);
    expect(
      dependencyBroadcastsTo(`board:${sprintBoard.id}`, 'cardDependencyCreate'),
    ).to.have.lengthOf(1);

    // ...and so does the REMOVAL. Same reason and the same failure without it:
    // a client watching only the blocker's board would go on drawing a
    // "Blocking" row for a card that is no longer waiting for anything.
    broadcasts.length = 0;
    const removed = await deleteDependency(tokens.editor, requestCard.id, cardB.id);
    expect(removed.status).to.equal(200);
    expect(
      dependencyBroadcastsTo(`board:${requestsBoard.id}`, 'cardDependencyDelete'),
    ).to.have.lengthOf(1);
    expect(
      dependencyBroadcastsTo(`board:${sprintBoard.id}`, 'cardDependencyDelete'),
    ).to.have.lengthOf(1);

    await Card.destroyOne(requestCard.id);
  });

  it('refuses a dependency on a card the caller cannot read', async () => {
    const res = await createDependency(tokens.editor, cardA.id, foreignCard.id);

    expect(res.status).to.equal(404);
  });

  it('refuses a board viewer', async () => {
    const res = await createDependency(tokens.viewer, cardA.id, cardC.id);

    expect(res.status).to.equal(403);
  });

  it('refuses a non-member', async () => {
    const res = await createDependency(tokens.outsider, cardA.id, cardC.id);

    expect(res.status).to.equal(404);
  });

  it('lists both directions with the related cards and their lists', async () => {
    const res = await getDependencies(tokens.editor, cardB.id);

    expect(res.status).to.equal(200);
    expect(res.body.items.map((item) => [item.cardId, item.dependsOnCardId])).to.deep.include([
      cardA.id,
      cardB.id,
    ]);

    const includedCardIds = res.body.included.cards.map((card) => card.id);
    expect(includedCardIds).to.include(cardA.id);

    const includedListIds = res.body.included.lists.map((list) => list.id);
    expect(includedListIds).to.include(sprintList.id);
  });

  it('carries the dependencies in the board payload', async () => {
    const res = await request
      .get(`/api/boards/${sprintBoard.id}`)
      .set('Authorization', `Bearer ${tokens.editor}`);

    expect(res.status).to.equal(200);
    expect(res.body.included.cardDependencies.map((item) => item.cardId)).to.include(cardA.id);
  });

  it('carries the dependencies in the card payload', async () => {
    const res = await request
      .get(`/api/cards/${cardA.id}`)
      .set('Authorization', `Bearer ${tokens.editor}`);

    expect(res.status).to.equal(200);
    expect(res.body.included.cardDependencies.map((item) => item.dependsOnCardId)).to.include(
      cardB.id,
    );
  });

  it('carries the dependencies in the list-of-cards payload', async () => {
    // The ENDLESS-LIST pagination path, which is a different controller from
    // the board read above (cards/index.js, not boards/show.js) and destructures
    // `cardDependencies` on the client either way. Without it a card paged in
    // this way arrives with no dependency rows and draws an empty "Dependent on".
    const res = await request
      .get(`/api/lists/${sprintList.id}/cards`)
      .set('Authorization', `Bearer ${tokens.editor}`);

    expect(res.status).to.equal(200);
    expect(res.body.included.cardDependencies.map((item) => item.dependsOnCardId)).to.include(
      cardB.id,
    );
  });

  it('removes a dependency', async () => {
    const res = await deleteDependency(tokens.editor, cardA.id, cardB.id);

    expect(res.status).to.equal(200);

    const stored = await CardDependency.qm.getOneByCardIdAndDependsOnCardId(cardA.id, cardB.id);
    expect(stored).to.equal(undefined);

    expect(
      dependencyBroadcastsTo(`board:${sprintBoard.id}`, 'cardDependencyDelete'),
    ).to.have.lengthOf(1);
  });

  it('answers 404 for a dependency that is not there', async () => {
    const res = await deleteDependency(tokens.editor, cardA.id, cardB.id);

    expect(res.status).to.equal(404);
  });

  // `sails.helpers.cards.deleteRelated` sweeps unreferenced uploads with raw
  // SQL, which the in-memory sails-disk datastore does not support, so this one
  // only runs against a real Postgres (TEST_DATABASE_URL).
  it('drops both directions when a card is deleted', async function dropsBothDirections() {
    try {
      await sails.sendNativeQuery('SELECT 1', []);
    } catch (error) {
      if (error.code === 'E_NOT_SUPPORTED') {
        this.skip();
      }

      throw error;
    }

    const doomed = await Card.create({
      id: id(),
      boardId: sprintBoard.id,
      listId: sprintList.id,
      creatorUserId: editor.id,
      type: Card.Types.PROJECT,
      position: 65536,
      name: 'Doomed',
    }).fetch();

    expect((await createDependency(tokens.editor, cardA.id, doomed.id)).status).to.equal(200);
    expect((await createDependency(tokens.editor, doomed.id, cardC.id)).status).to.equal(200);

    await sails.helpers.cards.deleteRelated(doomed);
    await Card.destroyOne(doomed.id);

    expect(await CardDependency.qm.getByCardId(doomed.id)).to.have.lengthOf(0);
    expect(await CardDependency.qm.getByDependsOnCardId(doomed.id)).to.have.lengthOf(0);
  });
});
