import orm from '../orm';
import { UserRoles } from '../constants/Enums';
import { selectIsFavoritesActiveForCurrentUser } from './projects';

const buildState = ({ pathname, isFavoritesEnabled = true, isFavorite = true }) => {
  const session = orm.session(orm.getEmptyState());

  session.User.create({ id: 'user-1', role: UserRoles.ADMIN });
  session.Project.create({
    id: 'project-1',
    name: 'Devteam',
    ownerProjectManagerId: null,
    isFavorite,
  });
  session.Board.create({ id: 'board-1', projectId: 'project-1' });

  return {
    auth: { userId: 'user-1' },
    core: { isFavoritesEnabled },
    router: { location: { pathname } },
    orm: session.state,
  };
};

describe('selectIsFavoritesActiveForCurrentUser', () => {
  test('shows the favorites bar on the home page', () => {
    expect(selectIsFavoritesActiveForCurrentUser(buildState({ pathname: '/' }))).toBe(true);
  });

  test('hides the favorites bar on a board page', () => {
    expect(selectIsFavoritesActiveForCurrentUser(buildState({ pathname: '/boards/board-1' }))).toBe(
      false,
    );
  });

  test('hides the favorites bar on a project page', () => {
    expect(
      selectIsFavoritesActiveForCurrentUser(buildState({ pathname: '/projects/project-1' })),
    ).toBe(false);
  });

  test('stays hidden on the home page when favorites are toggled off', () => {
    expect(
      selectIsFavoritesActiveForCurrentUser(
        buildState({ pathname: '/', isFavoritesEnabled: false }),
      ),
    ).toBe(false);
  });

  test('stays hidden on the home page when no project is a favorite', () => {
    expect(
      selectIsFavoritesActiveForCurrentUser(buildState({ pathname: '/', isFavorite: false })),
    ).toBe(false);
  });
});
