import orm from '../orm';
import { UserRoles } from '../constants/Enums';
import { selectIsHomePage } from './router';

const buildState = (pathname) => {
  const session = orm.session(orm.getEmptyState());

  session.User.create({ id: 'user-1', role: UserRoles.ADMIN });
  session.Project.create({ id: 'project-1', name: 'Devteam', ownerProjectManagerId: null });
  session.Board.create({ id: 'board-1', projectId: 'project-1' });

  return {
    auth: { userId: 'user-1' },
    router: { location: { pathname } },
    orm: session.state,
  };
};

describe('selectIsHomePage', () => {
  test('is true on the root path', () => {
    expect(selectIsHomePage(buildState('/'))).toBe(true);
  });

  test('is false on a project page', () => {
    expect(selectIsHomePage(buildState('/projects/project-1'))).toBe(false);
  });

  test('is false on a board page', () => {
    expect(selectIsHomePage(buildState('/boards/board-1'))).toBe(false);
  });

  test('is false on a board that is missing or unavailable', () => {
    expect(selectIsHomePage(buildState('/boards/board-missing'))).toBe(false);
  });
});
