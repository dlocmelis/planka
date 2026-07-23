const { expect } = require('chai');
const supertest = require('supertest');

const { MAX_ID_ARRAY_LENGTH } = require('../../../utils/validators');

const LIST_ID = '1357158568008091268';
const ANOTHER_LIST_ID = '1357158568008091269';

const MANAGER_USER_ID = '1357158568008091101';
const MEMBER_USER_ID = '1357158568008091102';
const OUTSIDER_USER_ID = '1357158568008091103';
const PROJECT_ID = '1357158568008091201';
const PROJECT_MANAGER_ID = '1357158568008091202';
const BOARD_ID = '1357158568008091203';

// NOTE: sails-disk (used in tests) generates numeric ids that never match
// id-based queries, so every record gets an explicit string id
let nextMembershipIdSerial = 300;

describe('board-memberships (controller)', () => {
  let request;

  let memberMembership;

  const authHeaderByRole = {};

  const createSession = async (user) => {
    const { token } = sails.helpers.utils.createJwtToken(user.id);

    await Session.qm.createOne({
      accessToken: token,
      userId: user.id,
      remoteAddress: '127.0.0.1',
    });

    return `Bearer ${token}`;
  };

  before(async () => {
    request = supertest(sails.hooks.http.app);

    const [managerUser, memberUser, outsiderUser] = await Promise.all(
      [
        [MANAGER_USER_ID, 'manager'],
        [MEMBER_USER_ID, 'member'],
        [OUTSIDER_USER_ID, 'outsider'],
      ].map(([id, name]) =>
        User.create({
          id,
          email: `${name}@test.test`,
          password: 'not-used-in-tests',
          role: User.Roles.BOARD_USER,
          name,
        }).fetch(),
      ),
    );

    await Project.create({
      id: PROJECT_ID,
      name: 'Test project',
    }).fetch();

    await ProjectManager.create({
      id: PROJECT_MANAGER_ID,
      projectId: PROJECT_ID,
      userId: managerUser.id,
    }).fetch();

    await Board.create({
      id: BOARD_ID,
      projectId: PROJECT_ID,
      position: 1,
      name: 'Test board',
    }).fetch();

    [authHeaderByRole.manager, authHeaderByRole.member, authHeaderByRole.outsider] =
      await Promise.all([managerUser, memberUser, outsiderUser].map(createSession));
  });

  beforeEach(async () => {
    memberMembership = await BoardMembership.create({
      id: `1357158568008091${nextMembershipIdSerial}`,
      projectId: PROJECT_ID,
      boardId: BOARD_ID,
      userId: MEMBER_USER_ID,
      role: BoardMembership.Roles.EDITOR,
    }).fetch();

    nextMembershipIdSerial += 1;
  });

  afterEach(async () => {
    await BoardMembership.destroy({});
  });

  describe('PATCH /api/board-memberships/:id', () => {
    it('should update and persist own hiddenListIds', async () => {
      const response = await request
        .patch(`/api/board-memberships/${memberMembership.id}`)
        .set('Authorization', authHeaderByRole.member)
        .send({ hiddenListIds: [LIST_ID, ANOTHER_LIST_ID] });

      expect(response.status).to.equal(200);
      expect(response.body.item.hiddenListIds).to.deep.equal([LIST_ID, ANOTHER_LIST_ID]);

      const reloaded = await BoardMembership.qm.getOneById(memberMembership.id);
      expect(reloaded.hiddenListIds).to.deep.equal([LIST_ID, ANOTHER_LIST_ID]);
    });

    it('should unhide lists by updating own hiddenListIds to an empty array', async () => {
      await BoardMembership.qm.updateOne(memberMembership.id, { hiddenListIds: [LIST_ID] });

      const response = await request
        .patch(`/api/board-memberships/${memberMembership.id}`)
        .set('Authorization', authHeaderByRole.member)
        .send({ hiddenListIds: [] });

      expect(response.status).to.equal(200);
      expect(response.body.item.hiddenListIds).to.deep.equal([]);

      const reloaded = await BoardMembership.qm.getOneById(memberMembership.id);
      expect(reloaded.hiddenListIds).to.deep.equal([]);
    });

    it('should not allow a member to change own role', async () => {
      const response = await request
        .patch(`/api/board-memberships/${memberMembership.id}`)
        .set('Authorization', authHeaderByRole.member)
        .send({ role: BoardMembership.Roles.VIEWER });

      expect(response.status).to.equal(404);

      const reloaded = await BoardMembership.qm.getOneById(memberMembership.id);
      expect(reloaded.role).to.equal(BoardMembership.Roles.EDITOR);
    });

    it('should not allow a member to change role together with hiddenListIds', async () => {
      const response = await request
        .patch(`/api/board-memberships/${memberMembership.id}`)
        .set('Authorization', authHeaderByRole.member)
        .send({ hiddenListIds: [LIST_ID], role: BoardMembership.Roles.VIEWER });

      expect(response.status).to.equal(404);

      const reloaded = await BoardMembership.qm.getOneById(memberMembership.id);
      expect(reloaded.role).to.equal(BoardMembership.Roles.EDITOR);
      expect(reloaded.hiddenListIds).to.deep.equal([]);
    });

    it('should not allow a member to change own canComment', async () => {
      const response = await request
        .patch(`/api/board-memberships/${memberMembership.id}`)
        .set('Authorization', authHeaderByRole.member)
        .send({ canComment: false });

      expect(response.status).to.equal(404);
    });

    it('should return not-found for another non-manager user', async () => {
      const response = await request
        .patch(`/api/board-memberships/${memberMembership.id}`)
        .set('Authorization', authHeaderByRole.outsider)
        .send({ hiddenListIds: [LIST_ID] });

      expect(response.status).to.equal(404);

      const reloaded = await BoardMembership.qm.getOneById(memberMembership.id);
      expect(reloaded.hiddenListIds).to.deep.equal([]);
    });

    it('should allow a project manager to update role and canComment', async () => {
      const response = await request
        .patch(`/api/board-memberships/${memberMembership.id}`)
        .set('Authorization', authHeaderByRole.manager)
        .send({ role: BoardMembership.Roles.VIEWER, canComment: true });

      expect(response.status).to.equal(200);
      expect(response.body.item.role).to.equal(BoardMembership.Roles.VIEWER);
      expect(response.body.item.canComment).to.equal(true);
    });

    it('should allow a project manager to update hiddenListIds', async () => {
      const response = await request
        .patch(`/api/board-memberships/${memberMembership.id}`)
        .set('Authorization', authHeaderByRole.manager)
        .send({ hiddenListIds: [LIST_ID] });

      expect(response.status).to.equal(200);
      expect(response.body.item.hiddenListIds).to.deep.equal([LIST_ID]);
    });

    it('should reject malformed hiddenListIds payloads', async () => {
      const malformedPayloads = [
        { hiddenListIds: null },
        { hiddenListIds: LIST_ID },
        { hiddenListIds: 'not-an-array' },
        { hiddenListIds: ['abc'] },
        { hiddenListIds: [42] },
        { hiddenListIds: [LIST_ID, '0'] },
        { hiddenListIds: new Array(MAX_ID_ARRAY_LENGTH + 1).fill('1') },
      ];

      await Promise.all(
        malformedPayloads.map(async (payload) => {
          const response = await request
            .patch(`/api/board-memberships/${memberMembership.id}`)
            .set('Authorization', authHeaderByRole.member)
            .send(payload);

          expect(response.status).to.equal(400);
        }),
      );
    });

    it('should reject malformed payloads for project managers as well', async () => {
      const response = await request
        .patch(`/api/board-memberships/${memberMembership.id}`)
        .set('Authorization', authHeaderByRole.manager)
        .send({ hiddenListIds: ['abc'] });

      expect(response.status).to.equal(400);
    });

    it('should return not-found for an unknown membership', async () => {
      const response = await request
        .patch('/api/board-memberships/1357158568008099999')
        .set('Authorization', authHeaderByRole.member)
        .send({ hiddenListIds: [LIST_ID] });

      expect(response.status).to.equal(404);
    });

    it('should return unauthorized without an access token', async () => {
      const response = await request
        .patch(`/api/board-memberships/${memberMembership.id}`)
        .send({ hiddenListIds: [LIST_ID] });

      expect(response.status).to.equal(401);
    });
  });
});
