const { expect } = require('chai');
const supertest = require('supertest');

describe('Lists isCollapsed (per-user)', function describeListsIsCollapsed() {
  this.timeout(30000);

  let request;
  let project;
  let board;
  let list;
  let editor;
  let viewer;
  let outsider;

  const tokens = {};
  const broadcasts = [];

  let originalBroadcast;

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

  const patchList = (token, values) =>
    request.patch(`/api/lists/${list.id}`).set('Authorization', `Bearer ${token}`).send(values);

  const getBoard = (token) =>
    request.get(`/api/boards/${board.id}`).set('Authorization', `Bearer ${token}`);

  const listUpdateBroadcastsTo = (room) =>
    broadcasts.filter(([roomName, event]) => roomName === room && event === 'listUpdate');

  before(async () => {
    request = supertest(sails.hooks.http.app);

    originalBroadcast = sails.sockets.broadcast;
    sails.sockets.broadcast = (...args) => {
      broadcasts.push(args);
      return originalBroadcast(...args);
    };

    project = await Project.create({
      id: '1825476504885136001',
      name: 'Test Project',
    }).fetch();

    board = await Board.create({
      id: '1825476504885136002',
      projectId: project.id,
      position: 1,
      name: 'Test Board',
    }).fetch();

    list = await List.create({
      id: '1825476504885136003',
      boardId: board.id,
      type: List.Types.ACTIVE,
      position: 65536,
      name: 'Test List',
    }).fetch();

    [editor, viewer, outsider] = await Promise.all(
      ['editor', 'viewer', 'outsider'].map((name, index) =>
        User.create({
          id: `182547650488513600${4 + index}`,
          email: `${name}@example.com`,
          username: name,
          role: User.Roles.BOARD_USER,
          name,
        }).fetch(),
      ),
    );

    await BoardMembership.create({
      projectId: project.id,
      boardId: board.id,
      userId: editor.id,
      role: BoardMembership.Roles.EDITOR,
    }).fetch();

    await BoardMembership.create({
      projectId: project.id,
      boardId: board.id,
      userId: viewer.id,
      role: BoardMembership.Roles.VIEWER,
    }).fetch();

    tokens.editor = await mintAccessToken(editor);
    tokens.viewer = await mintAccessToken(viewer);
    tokens.outsider = await mintAccessToken(outsider);
  });

  after(() => {
    sails.sockets.broadcast = originalBroadcast;
  });

  beforeEach(() => {
    broadcasts.length = 0;
  });

  it('allows a board viewer to collapse a list with only {isCollapsed}', async () => {
    const res = await patchList(tokens.viewer, { isCollapsed: true });

    expect(res.status).to.equal(200);

    const listCollapse = await ListCollapse.qm.getOneByListIdAndUserId(list.id, viewer.id);
    expect(listCollapse).to.be.an('object');

    expect(listUpdateBroadcastsTo(`board:${board.id}`)).to.have.lengthOf(0);

    const userBroadcasts = listUpdateBroadcastsTo(`user:${viewer.id}`);
    expect(userBroadcasts).to.have.lengthOf(1);
    expect(userBroadcasts[0][2]).to.deep.equal({
      item: {
        id: list.id,
        isCollapsed: true,
      },
    });
  });

  it('does not re-broadcast when the collapse state is unchanged', async () => {
    const res = await patchList(tokens.viewer, { isCollapsed: true });

    expect(res.status).to.equal(200);
    expect(broadcasts.filter(([, event]) => event === 'listUpdate')).to.have.lengthOf(0);

    const listCollapses = await ListCollapse.find({
      listId: list.id,
      userId: viewer.id,
    });
    expect(listCollapses).to.have.lengthOf(1);
  });

  it('allows a board viewer to expand the list again', async () => {
    const res = await patchList(tokens.viewer, { isCollapsed: false });

    expect(res.status).to.equal(200);

    const listCollapse = await ListCollapse.qm.getOneByListIdAndUserId(list.id, viewer.id);
    expect(listCollapse).to.equal(undefined);

    expect(listUpdateBroadcastsTo(`board:${board.id}`)).to.have.lengthOf(0);

    const userBroadcasts = listUpdateBroadcastsTo(`user:${viewer.id}`);
    expect(userBroadcasts).to.have.lengthOf(1);
    expect(userBroadcasts[0][2]).to.deep.equal({
      item: {
        id: list.id,
        isCollapsed: false,
      },
    });
  });

  it('rejects shared-field updates from a board viewer', async () => {
    const res = await patchList(tokens.viewer, { name: 'Nope' });

    expect(res.status).to.equal(403);
  });

  it('rejects isCollapsed updates from non-members', async () => {
    const res = await patchList(tokens.outsider, { isCollapsed: true });

    expect(res.status).to.equal(404);

    const listCollapse = await ListCollapse.qm.getOneByListIdAndUserId(list.id, outsider.id);
    expect(listCollapse).to.equal(undefined);
  });

  it('keeps isCollapsed out of board-room broadcasts on shared-field updates', async () => {
    const res = await patchList(tokens.editor, {
      name: 'Renamed',
      isCollapsed: true,
    });

    expect(res.status).to.equal(200);
    expect(res.body.item.name).to.equal('Renamed');

    const listCollapse = await ListCollapse.qm.getOneByListIdAndUserId(list.id, editor.id);
    expect(listCollapse).to.be.an('object');

    const boardBroadcasts = listUpdateBroadcastsTo(`board:${board.id}`);
    expect(boardBroadcasts).to.have.lengthOf(1);
    expect(boardBroadcasts[0][2].item).to.not.have.property('isCollapsed');

    const userBroadcasts = listUpdateBroadcastsTo(`user:${editor.id}`);
    expect(userBroadcasts).to.have.lengthOf(1);
    expect(userBroadcasts[0][2]).to.deep.equal({
      item: {
        id: list.id,
        isCollapsed: true,
      },
    });
  });

  it('returns explicit per-user isCollapsed on every list in boards/show', async () => {
    const editorRes = await getBoard(tokens.editor);
    expect(editorRes.status).to.equal(200);
    expect(editorRes.body.included.lists).to.not.have.lengthOf(0);

    editorRes.body.included.lists.forEach((includedList) => {
      expect(includedList.isCollapsed).to.be.a('boolean');
    });

    const editorList = editorRes.body.included.lists.find(
      (includedList) => includedList.id === list.id,
    );
    expect(editorList.isCollapsed).to.equal(true);

    const viewerRes = await getBoard(tokens.viewer);
    expect(viewerRes.status).to.equal(200);

    const viewerList = viewerRes.body.included.lists.find(
      (includedList) => includedList.id === list.id,
    );
    expect(viewerList.isCollapsed).to.equal(false);
  });
});
