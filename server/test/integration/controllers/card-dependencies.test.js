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

  let requestCard;

  const tokens = {};
  const broadcasts = [];
  const webhookCalls = [];

  let originalBroadcast;
  let originalSendWebhooks;
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

  const webhooksFor = (event) => webhookCalls.filter((call) => call.body.event === event);

  // True when the suite is running against a real Postgres (TEST_DATABASE_URL)
  // rather than the in-memory sails-disk datastore.
  //
  // Two things are only true there, and both bite the dependency tests: raw SQL
  // works at all (the attachment sweep on the card-delete path uses it), and
  // ids are the strings the models declare. sails-disk mints NUMERIC ids, so a
  // card created THROUGH the API comes back as id 1 and a dependency row naming
  // it is refused by Waterline for being the wrong type.
  const onRealDatabase = async () => {
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

  // Every case that needs a link creates it itself, through the API, in the
  // case that needs it — the table is emptied between cases (see beforeEach),
  // so no case inherits a row an earlier one happened to leave behind and the
  // file may be run with .only, reordered or filtered.
  const givenDependency = async (cardId, dependsOnCardId) => {
    const res = await createDependency(tokens.editor, cardId, dependsOnCardId);
    expect(res.status).to.equal(200);
    return res.body.item;
  };

  before(async () => {
    request = supertest(sails.hooks.http.app);

    originalBroadcast = sails.sockets.broadcast;
    sails.sockets.broadcast = (...args) => {
      broadcasts.push(args);
      return originalBroadcast(...args);
    };

    // A REAL subscriber row and the real send path, with only the outbound
    // fetch swapped out. Going through the row rather than stubbing the helper
    // is what makes the `events` allow-list part of the test: a Planka webhook
    // may name the events it wants, and a row that does not name
    // cardDependencyCreate is silently skipped — which is exactly the state the
    // orchestrator's own row was found in on the deployed board.
    originalSendWebhooks = global.fetch;
    global.fetch = async (url, options) => {
      webhookCalls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, text: async () => '' };
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

    requestCard = await Card.create({
      id: id(),
      boardId: requestsBoard.id,
      listId: requestsList.id,
      creatorUserId: editor.id,
      type: Card.Types.PROJECT,
      position: 65536,
      name: 'User request',
    }).fetch();

    // Subscribed to the two dependency events BY NAME rather than to
    // everything, because that is the shape the deployed row has and the
    // shape that has to work: a webhook whose `events` list does not name
    // cardDependencyCreate never hears about a dependency at all.
    await Webhook.create({
      id: id(),
      name: 'Dependency subscriber',
      url: 'http://127.0.0.1:9/planka-webhook',
      events: [Webhook.Events.CARD_DEPENDENCY_CREATE, Webhook.Events.CARD_DEPENDENCY_DELETE],
    }).fetch();
  });

  after(async () => {
    sails.sockets.broadcast = originalBroadcast;
    global.fetch = originalSendWebhooks;
    await Webhook.destroy({ name: 'Dependency subscriber' });
  });

  beforeEach(async () => {
    broadcasts.length = 0;
    webhookCalls.length = 0;

    // The reset that makes the cases independent of each other.
    await CardDependency.qm.delete({});
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
    await givenDependency(cardA.id, cardB.id);

    const res = await createDependency(tokens.editor, cardA.id, cardB.id);

    expect(res.status).to.equal(409);
  });

  it('refuses a card that depends on itself', async () => {
    const res = await createDependency(tokens.editor, cardA.id, cardA.id);

    expect(res.status).to.equal(422);
  });

  it('refuses a dependency that would close a cycle', async () => {
    await givenDependency(cardA.id, cardB.id);

    // A already waits for B; B waiting for A would deadlock both of them.
    const direct = await createDependency(tokens.editor, cardB.id, cardA.id);
    expect(direct.status).to.equal(422);

    // ...and so would the same loop taken the long way round: B → C → A.
    const throughC = await createDependency(tokens.editor, cardB.id, cardC.id);
    expect(throughC.status).to.equal(200);

    const closing = await createDependency(tokens.editor, cardC.id, cardA.id);
    expect(closing.status).to.equal(422);
  });

  it('allows a dependency across boards', async () => {
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
    await givenDependency(cardA.id, cardB.id);

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
    await givenDependency(cardA.id, cardB.id);

    const res = await request
      .get(`/api/boards/${sprintBoard.id}`)
      .set('Authorization', `Bearer ${tokens.editor}`);

    expect(res.status).to.equal(200);
    expect(res.body.included.cardDependencies.map((item) => item.cardId)).to.include(cardA.id);
  });

  it('carries the dependencies in the card payload', async () => {
    await givenDependency(cardA.id, cardB.id);

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
    await givenDependency(cardA.id, cardB.id);

    const res = await request
      .get(`/api/lists/${sprintList.id}/cards`)
      .set('Authorization', `Bearer ${tokens.editor}`);

    expect(res.status).to.equal(200);
    expect(res.body.included.cardDependencies.map((item) => item.dependsOnCardId)).to.include(
      cardB.id,
    );
  });

  it('removes a dependency', async () => {
    await givenDependency(cardA.id, cardB.id);
    broadcasts.length = 0;

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
  // only runs against a real Postgres (TEST_DATABASE_URL). The case below it
  // covers the dependency half of the same cascade everywhere.
  it('drops both directions when a card is deleted', async function dropsBothDirections() {
    if (!(await onRealDatabase())) {
      this.skip();
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

  // The half of the case above that does NOT need Postgres: the dependency
  // cascade itself, taken straight rather than through the attachment sweep
  // that raw-SQLs its way past sails-disk. Both directions, and the far board
  // is told — which is the part a client on the OTHER board depends on.
  it('drops both directions and tells the other board when a card goes', async () => {
    const doomed = await Card.create({
      id: id(),
      boardId: sprintBoard.id,
      listId: sprintList.id,
      creatorUserId: editor.id,
      type: Card.Types.PROJECT,
      position: 65536,
      name: 'Doomed',
    }).fetch();

    // requestCard (on the OTHER board) waits for the doomed card, and the
    // doomed card waits for cardC (on its own board).
    await givenDependency(requestCard.id, doomed.id);
    await givenDependency(doomed.id, cardC.id);
    broadcasts.length = 0;

    const dropped = await sails.helpers.cardDependencies.deleteForCards(doomed);

    expect(dropped).to.have.lengthOf(2);
    expect(await CardDependency.qm.getByCardId(doomed.id)).to.have.lengthOf(0);
    expect(await CardDependency.qm.getByDependsOnCardId(doomed.id)).to.have.lengthOf(0);

    // The other board is in a different socket room and hears nothing about
    // this card being deleted, so without this broadcast it goes on drawing a
    // "Blocking" row for a card that is gone until somebody reloads it.
    const toRequestsBoard = dependencyBroadcastsTo(
      `board:${requestsBoard.id}`,
      'cardDependencyDelete',
    );
    expect(toRequestsBoard).to.have.lengthOf(1);
    expect(toRequestsBoard[0][2].item.cardId).to.equal(requestCard.id);
    expect(toRequestsBoard[0][2].item.dependsOnCardId).to.equal(doomed.id);

    // The doomed card's own board is NOT told twice: it gets cardDelete, and
    // models/Card.js clears the rows of a card it hears about.
    expect(
      dependencyBroadcastsTo(`board:${sprintBoard.id}`, 'cardDependencyDelete'),
    ).to.have.lengthOf(0);

    await Card.destroyOne(doomed.id);
  });

  // Real database only: the duplicate is created THROUGH the API, so it gets
  // the datastore's own id, and sails-disk's is a number the dependency column
  // will not take (see onRealDatabase).
  it('gives a duplicated card what the original was waiting for, and nothing more', async function duplicateCarriesDependencies() {
    if (!(await onRealDatabase())) {
      this.skip();
    }

    // Both directions exist on cardA: it waits for cardB, and requestCard (on
    // the other board) waits for cardA.
    await givenDependency(cardA.id, cardB.id);
    await givenDependency(requestCard.id, cardA.id);
    broadcasts.length = 0;

    const res = await request
      .post(`/api/cards/${cardA.id}/duplicate`)
      .set('Authorization', `Bearer ${tokens.editor}`)
      .send({ position: 65537, name: 'Card A (copy)' });

    expect(res.status).to.equal(200);

    const copyId = res.body.item.id;

    // What the original waits for is a fact about the work, so the copy waits
    // for it too — otherwise a duplicate would be a way around the dependency.
    const copyWaitsFor = await CardDependency.qm.getByCardId(copyId);
    expect(copyWaitsFor.map((item) => item.dependsOnCardId)).to.deep.equal([cardB.id]);

    // What waits for the original is a fact about OTHER cards, and requestCard
    // did not ask to be blocked by a copy somebody made.
    expect(await CardDependency.qm.getByDependsOnCardId(copyId)).to.have.lengthOf(0);

    // The response carries them, because the client destructures
    // included.cardDependencies out of this very call
    // (client/src/sagas/core/services/cards.js duplicateCard) and upserts them
    // on CARD_DUPLICATE__SUCCESS.
    expect(res.body.included.cardDependencies.map((item) => item.dependsOnCardId)).to.deep.equal([
      cardB.id,
    ]);

    // ...and both rooms are told, after the card itself.
    const created = dependencyBroadcastsTo(`board:${sprintBoard.id}`, 'cardDependencyCreate');
    expect(created).to.have.lengthOf(1);
    expect(created[0][2].item.cardId).to.equal(copyId);

    const cardCreateIndex = broadcasts.findIndex(([, event]) => event === 'cardCreate');
    const dependencyIndex = broadcasts.findIndex(([, event]) => event === 'cardDependencyCreate');
    expect(cardCreateIndex).to.be.greaterThan(-1);
    expect(dependencyIndex).to.be.greaterThan(cardCreateIndex);

    await sails.helpers.cardDependencies.deleteForCards(await Card.qm.getOneById(copyId));
    await Card.destroyOne(copyId);
  });

  it('answers the row-level cycle guard the way it answers its own walk', async () => {
    // The walk in create-one reads and then writes, so a second request can
    // close a loop in between; the trigger added in
    // db/migrations/20260821180000_add_card_dependency_cycle_guard refuses that
    // write. Simulated here rather than raced, because the in-memory test
    // datastore has no triggers — what is being pinned is that the refusal
    // comes back as the 422 the walk gives and not as a 500.
    const originalCreateOne = CardDependency.qm.createOne;

    CardDependency.qm.createOne = () =>
      Promise.reject(
        Object.assign(
          new Error(
            'error: card_dependency_cycle: card 12 already waits for card 13\n    at Parser.parseErrorMessage',
          ),
          { code: 'E_UNKNOWN' },
        ),
      );

    try {
      const res = await createDependency(tokens.editor, cardA.id, cardB.id);

      expect(res.status).to.equal(422);
      expect(res.body.message).to.equal('Dependency would create cycle');
    } finally {
      CardDependency.qm.createOne = originalCreateOne;
    }
  });

  it('tells webhook subscribers when a dependency is placed, with both cards named', async () => {
    await givenDependency(requestCard.id, cardB.id);

    const calls = webhooksFor(Webhook.Events.CARD_DEPENDENCY_CREATE);
    expect(calls).to.have.lengthOf(1);

    // The exact document a consumer parses: devteam-orchestrator's
    // internal/webhook/webhook.go reads item.cardId and item.dependsOnCardId,
    // then picks the WAITING card out of included.cards BY ID to learn which
    // board and list it is on. Asserted field by field because a consumer that
    // took included.cards[0] instead would read the blocker's board as the
    // waiting card's.
    const { data } = calls[0].body;
    expect(data.item.cardId).to.equal(requestCard.id);
    expect(data.item.dependsOnCardId).to.equal(cardB.id);

    const waiting = data.included.cards.find((card) => card.id === requestCard.id);
    expect(waiting).to.be.an('object');
    expect(waiting.boardId).to.equal(requestsBoard.id);
    expect(waiting.listId).to.equal(requestsList.id);
    expect(waiting.name).to.equal(requestCard.name);

    expect(data.included.cards.map((card) => card.id)).to.have.members([requestCard.id, cardB.id]);
    expect(data.included.boards.map((board) => board.id)).to.include(requestsBoard.id);
    expect(data.included.lists.map((list) => list.id)).to.include(requestsList.id);
    expect(data.included.projects.map((item) => item.id)).to.include(project.id);
  });

  it('tells webhook subscribers when a dependency is removed', async () => {
    await givenDependency(requestCard.id, cardB.id);
    webhookCalls.length = 0;

    expect((await deleteDependency(tokens.editor, requestCard.id, cardB.id)).status).to.equal(200);

    const calls = webhooksFor(Webhook.Events.CARD_DEPENDENCY_DELETE);
    expect(calls).to.have.lengthOf(1);

    const { data } = calls[0].body;
    expect(data.item.cardId).to.equal(requestCard.id);
    expect(data.item.dependsOnCardId).to.equal(cardB.id);

    const waiting = data.included.cards.find((card) => card.id === requestCard.id);
    expect(waiting).to.be.an('object');
    expect(waiting.boardId).to.equal(requestsBoard.id);
    expect(waiting.listId).to.equal(requestsList.id);
  });
});
