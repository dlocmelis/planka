const { expect } = require('chai');

const {
  FilterError,
  classify,
  compute,
  creatorOf,
  creatorOptions,
  hasCardFilter,
  matchCards,
  missingCreations,
  parseCost,
  parseFilters,
  parseReporter,
  reachOf,
  secondsToDoneByCardId,
} = require('../../utils/pipeline-statistics');

const NOW = new Date('2026-09-24T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

const list = (name, type = 'active') => ({ id: name, type, ...(name && { name }) });

let nextId = 1;

const created = (cardId, at, listName = 'Backlog') => {
  nextId += 1;
  return {
    id: String(nextId),
    type: 'createCard',
    cardId,
    createdAt: at,
    data: { card: { name: cardId }, list: list(listName) },
  };
};

const moved = (cardId, at, from, to) => {
  nextId += 1;
  return {
    id: String(nextId),
    type: 'moveCard',
    cardId,
    createdAt: at,
    data: {
      fromList: typeof from === 'string' ? list(from) : from,
      toList: typeof to === 'string' ? list(to) : to,
    },
  };
};

const period = (result, key) => result.periods.find((item) => item.key === key);

describe('pipeline statistics (board flow)', () => {
  it('reads each move by the orchestrator column names it goes between', () => {
    expect(classify(created('c', ago(HOUR))).entered).to.equal(true);
    // A thread, a chat or a work item is not a ticket entering the board.
    expect(classify(created('c', ago(HOUR), 'Threads')).entered).to.equal(false);
    expect(classify(created('c', ago(HOUR), 'item queue')).entered).to.equal(false);

    expect(classify(moved('c', ago(HOUR), 'Ready for Testing', 'Done'))).to.include({
      completed: true,
      testingAccepted: true,
      testingRejected: false,
    });
    // The User Requests board's name for Done, compared case-insensitively.
    expect(classify(moved('c', ago(HOUR), 'Ready for Testing', ' tested by user '))).to.include({
      completed: true,
      testingAccepted: true,
    });
    expect(classify(moved('c', ago(HOUR), 'In Deployment', 'Ready for Testing'))).to.include({
      deployed: true,
      testingSent: true,
    });
    expect(classify(moved('c', ago(HOUR), 'Blocked', 'Deployment Done')).deployed).to.equal(true);
    // Leaving In Deployment BACKWARDS is not a deploy.
    expect(classify(moved('c', ago(HOUR), 'In Deployment', 'In Development')).deployed).to.equal(
      false,
    );
    expect(classify(moved('c', ago(HOUR), 'Ready for Testing', 'Reopened'))).to.include({
      reopened: true,
      testingRejected: true,
    });
    expect(
      classify(moved('c', ago(HOUR), 'Ready for Testing', 'Ready for Development')),
    ).to.include({ testingRejected: true, reopened: false });
    // Taking a finished card back into work reopens it; archiving one does not.
    expect(classify(moved('c', ago(HOUR), 'Tested by User', 'In Development')).reopened).to.equal(
      true,
    );
    expect(classify(moved('c', ago(HOUR), 'Done', list(undefined, 'archive'))).reopened).to.equal(
      false,
    );
    // Parking a card that is being tested is neither a verdict nor a send.
    expect(classify(moved('c', ago(HOUR), 'Ready for Testing', 'Blocked'))).to.include({
      testingAccepted: false,
      testingRejected: false,
      testingSent: false,
    });
  });

  it('counts distinct cards and testing decisions into each period and the one before it', () => {
    const actions = [
      // A: created 3 days ago, deployed, sent to testing, rejected, back,
      // accepted within the last day.
      created('A', ago(3 * DAY)),
      moved('A', ago(20 * HOUR), 'In Deployment', 'Ready for Testing'),
      moved('A', ago(18 * HOUR), 'Ready for Testing', 'Reopened'),
      moved('A', ago(10 * HOUR), 'In Deployment', 'Ready for Testing'),
      moved('A', ago(2 * HOUR), 'Ready for Testing', 'Done'),
      // B: created and completed within the day; completed twice (bounced).
      created('B', ago(6 * HOUR)),
      moved('B', ago(4 * HOUR), 'Ready for Development', 'Done'),
      moved('B', ago(3 * HOUR), 'Done', 'In Development'),
      moved('B', ago(2 * HOUR), 'In Development', 'Done'),
      // C: a thread card — not entered.
      created('C', ago(HOUR), 'Threads'),
      // D: completed yesterday-but-one (the 24h period's previous window).
      created('D', ago(40 * HOUR)),
      moved('D', ago(30 * HOUR), 'Ready for Testing', 'Tested by User'),
      // E: completed now-ish but created long ago; its creation is read apart.
      moved('E', ago(HOUR), 'Deployment Done', 'Done'),
    ];
    const creations = [created('E', ago(50 * DAY))];

    const result = compute({ actions, creations, now: NOW, since: ago(65 * DAY) });

    expect(result.now).to.equal(NOW.toISOString());
    expect(result.since).to.equal(ago(65 * DAY));
    expect(result.periods.map((item) => item.key)).to.deep.equal(['24h', '7d', '30d']);

    const day = period(result, '24h');
    expect(day.seconds).to.equal(86400);
    expect(day.current.from).to.equal(ago(DAY));
    expect(day.current.to).to.equal(NOW.toISOString());
    expect(day.previous.from).to.equal(ago(2 * DAY));
    expect(day.previous.to).to.equal(ago(DAY));

    expect(day.current).to.include({
      entered: 1, // B (A and D entered earlier, C is a thread)
      completed: 2 + 1, // A, B (once, though twice), E
      deployed: 1, // A (twice, one card)
      reopened: 2, // A (Reopened), B (Done -> In Development)
      testingSent: 2, // A, twice
      testingAccepted: 1,
      testingRejected: 1,
      acceptanceRate: 0.5,
      timedToDone: 3,
    });
    // A: 3d - 2h = 70h; B: 6h - 4h = 2h (its FIRST completion); E: 50d - 1h.
    // Median of 2h, 70h, 1199h is 70h.
    expect(day.current.medianSecondsToDone).to.equal(70 * 3600);

    expect(day.previous).to.include({
      entered: 1, // D
      completed: 1,
      testingAccepted: 1, // Ready for Testing -> Tested by User
    });

    const week = period(result, '7d');
    expect(week.current).to.include({ entered: 3, completed: 4, deployed: 1 });
    expect(week.current.acceptanceRate).to.equal(2 / 3);
    expect(period(result, '30d').previous).to.include({
      entered: 0,
      completed: 0,
      acceptanceRate: null,
      medianSecondsToDone: null,
    });
  });

  it('times a card from its creation, and says when the history start is unknown', () => {
    const result = compute({
      actions: [
        created('D', ago(40 * HOUR)),
        moved('D', ago(30 * HOUR), 'Ready for Testing', 'Tested by User'),
      ],
      now: NOW,
    });

    expect(period(result, '24h').previous).to.include({
      testingAccepted: 1,
      acceptanceRate: 1,
      medianSecondsToDone: 10 * 3600,
    });
    expect(result.since).to.equal(null);
  });

  it('names the completed cards whose creation lies before the read', () => {
    expect(
      missingCreations([
        created('A', ago(DAY)),
        moved('A', ago(HOUR), 'Ready for Testing', 'Done'),
        moved('E', ago(HOUR), 'Deployment Done', 'Done'),
        moved('F', ago(HOUR), 'In Review', 'Ready for Deployment'),
      ]),
    ).to.deep.equal(['E']);
  });
});

describe('pipeline statistics filters', () => {
  const header = (reporterLine) =>
    [
      '**Setlfi ticket**',
      '',
      reporterLine,
      'Project: Tunzer (6a57aa2cc609223fff50b85c)',
      'Request: SR-000001',
      'Type: bug',
      '',
      '---',
      '',
      'The customer text.',
    ].join('\n');

  describe('the creator', () => {
    it('reads the reporter off the Setlfi header, and nowhere else', () => {
      expect(parseReporter(header('Reporter: Deniss Locmelis den@setlfi.com'))).to.deep.equal({
        name: 'Deniss Locmelis',
        email: 'den@setlfi.com',
      });
      // The header as it was written before, and an address a Markdown editor
      // turned into a mailto link.
      expect(
        parseReporter(
          '--- Setlfi ---\nReporter: Nikita Licovs [n.l@tunzer.net](mailto:n.l@tunzer.net)\n--------------\n',
        ),
      ).to.deep.equal({ name: 'Nikita Licovs', email: 'n.l@tunzer.net' });
      expect(parseReporter(header('Reporter: Jon Snow'))).to.deep.equal({
        name: 'Jon Snow',
        email: '',
      });
      // A card somebody wrote by hand, and a "Reporter:" below the header's
      // closing rule, name nobody.
      expect(parseReporter('Reporter: Mallory m@evil.test\nPlease fix')).to.equal(null);
      expect(
        parseReporter('**Setlfi ticket**\n\nProject: P\n\n---\n\nReporter: Mallory m@evil.test'),
      ).to.equal(null);
      expect(parseReporter(null)).to.equal(null);
    });

    it('is the reporter keyed by address, else the Planka user who created the card', () => {
      const deniss = { id: '7', name: 'Deniss', email: 'Deniss.Locmelis@gmail.com' };

      expect(
        creatorOf({ description: header('Reporter: Den Loc DEN@setlfi.com') }, deniss),
      ).to.deep.equal({ key: 'den@setlfi.com', name: 'Den Loc' });
      expect(creatorOf({ description: 'Hand-written card' }, deniss)).to.deep.equal({
        key: 'deniss.locmelis@gmail.com',
        name: 'Deniss',
      });
      expect(creatorOf({ description: null }, { id: '8', username: 'bot' })).to.deep.equal({
        key: 'user:8',
        name: 'bot',
      });
      expect(creatorOf({ description: header('Reporter: Jon Snow') }, deniss)).to.deep.equal({
        key: 'name:jon snow',
        name: 'Jon Snow',
      });
      // The creating user was deleted.
      expect(creatorOf({ description: '' }, undefined)).to.equal(null);
    });

    it('lists each creator once, under the name most of their cards carry, busiest first', () => {
      expect(
        creatorOptions([
          { key: 'den@setlfi.com', name: 'Deniss Locmelis' },
          { key: 'den@setlfi.com', name: 'Den Loc' },
          { key: 'den@setlfi.com', name: 'Deniss Locmelis' },
          { key: 'den@setlfi.com', name: 'Deni Loci' },
          null,
          { key: 'hq@setlfi.com', name: 'Jon Snow' },
          { key: 'user:8', name: 'Orchestrator Bot' },
        ]),
      ).to.deep.equal([
        { key: 'den@setlfi.com', name: 'Deniss Locmelis', cards: 4 },
        { key: 'hq@setlfi.com', name: 'Jon Snow', cards: 1 },
        { key: 'user:8', name: 'Orchestrator Bot', cards: 1 },
      ]);
    });
  });

  it('reads the dollars out of the cost field', () => {
    expect(parseCost('$1.97')).to.equal(1.97);
    expect(parseCost('$1,234.50')).to.equal(1234.5);
    expect(parseCost(' $0.00 ')).to.equal(0);
    expect(parseCost('unpriced')).to.equal(null);
    expect(parseCost('')).to.equal(null);
    expect(parseCost(undefined)).to.equal(null);
  });

  it('times each card from entering the board to its FIRST completion', () => {
    const seconds = secondsToDoneByCardId([
      moved('A', ago(2 * HOUR), 'In Development', 'Done'),
      created('A', ago(10 * HOUR)),
      moved('A', ago(6 * HOUR), 'In Development', 'Done'),
      moved('A', ago(5 * HOUR), 'Done', 'In Development'),
      // Never done.
      created('B', ago(10 * HOUR)),
      moved('B', ago(6 * HOUR), 'Backlog', 'In Development'),
      // Done, but its creation is not in the history.
      moved('C', ago(HOUR), 'In Review', 'Done'),
    ]);

    expect([...seconds.entries()]).to.deep.equal([['A', 4 * 3600]]);
  });

  describe('matching cards', () => {
    const cards = [
      {
        id: 'A',
        name: 'Fix the login page',
        description: header('Reporter: Deniss Locmelis den@setlfi.com'),
        labelIds: ['L1', 'L2'],
        creator: { key: 'den@setlfi.com', name: 'Deniss Locmelis' },
        costUsd: 1.97,
        secondsToDone: 2 * 3600,
      },
      {
        id: 'B',
        name: 'Statistics filters',
        description: 'Filter Board flow by LABELS',
        labelIds: ['L2'],
        creator: { key: 'user:8', name: 'Orchestrator Bot' },
        costUsd: 40.3,
        secondsToDone: null,
      },
      {
        id: 'C',
        name: 'Deploy notes',
        description: null,
        labelIds: [],
        creator: null,
        costUsd: null,
        secondsToDone: 30 * 3600,
      },
    ];

    const ids = (filters) => [...matchCards(cards, filters)].sort();

    it('matches any of the labels', () => {
      expect(ids({ labelIds: ['L1'] })).to.deep.equal(['A']);
      expect(ids({ labelIds: ['L1', 'L2'] })).to.deep.equal(['A', 'B']);
      expect(ids({ labelIds: ['L9'] })).to.deep.equal([]);
    });

    it('matches a keyword in the name or the description, in any case', () => {
      expect(ids({ search: 'login' })).to.deep.equal(['A']);
      expect(ids({ search: 'labels' })).to.deep.equal(['B']);
      expect(ids({ search: 'den@setlfi' })).to.deep.equal(['A']);
    });

    it('matches any of the creators, and never a card nobody is known to have created', () => {
      expect(ids({ creators: ['den@setlfi.com'] })).to.deep.equal(['A']);
      expect(ids({ creators: ['den@setlfi.com', 'user:8'] })).to.deep.equal(['A', 'B']);
    });

    it('matches time to done and cost inclusively, and drops cards without the figure', () => {
      expect(ids({ duration: { min: 3600, max: null } })).to.deep.equal(['A', 'C']);
      expect(ids({ duration: { min: null, max: 2 * 3600 } })).to.deep.equal(['A']);
      expect(ids({ cost: { min: 1.97, max: 40.3 } })).to.deep.equal(['A', 'B']);
      expect(ids({ cost: { min: 2, max: null } })).to.deep.equal(['B']);
      expect(ids({ cost: { min: null, max: 0 } })).to.deep.equal([]);
    });

    it('combines different filters with AND', () => {
      expect(ids({ labelIds: ['L2'], search: 'statistics' })).to.deep.equal(['B']);
      expect(ids({ labelIds: ['L2'], cost: { min: null, max: 10 } })).to.deep.equal(['A']);
      expect(ids({ creators: ['user:8'], duration: { min: 0, max: null } })).to.deep.equal([]);
    });
  });

  describe('reading the query', () => {
    it('reads no parameters as no filter and the usual periods', () => {
      expect(parseFilters({})).to.deep.equal({ filters: {}, range: null });
      expect(parseFilters({ search: '  ', labelIds: '' })).to.deep.equal({
        filters: {},
        range: null,
      });
      expect(hasCardFilter({})).to.equal(false);
    });

    it('reads every filter', () => {
      const { filters, range } = parseFilters({
        labelIds: '11, 12',
        search: ' Login ',
        creators: 'Den@Setlfi.com,user:8',
        durationMin: '3600',
        costMax: '12.5',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-15T00:00:00+03:00',
      });

      expect(filters).to.deep.equal({
        labelIds: ['11', '12'],
        search: 'login',
        creators: ['den@setlfi.com', 'user:8'],
        duration: { min: 3600, max: null },
        cost: { min: null, max: 12.5 },
      });
      expect(range).to.deep.equal({
        fromMs: Date.parse('2026-09-01T00:00:00.000Z'),
        toMs: Date.parse('2026-09-14T21:00:00.000Z'),
      });
      expect(hasCardFilter(filters)).to.equal(true);
    });

    it('refuses what it does not understand rather than answer unfiltered', () => {
      [
        { labelIds: '12,abc' },
        { durationMin: '-1' },
        { costMin: 'ten' },
        { costMin: '5', costMax: '2' },
        { from: '2026-09-01T00:00:00Z' },
        { from: '2026-09-01', to: '2026-09-02' },
        { from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' },
        { search: 'x'.repeat(257) },
        { search: ['a', 'b'] },
      ].forEach((query) => {
        expect(() => parseFilters(query), JSON.stringify(query)).to.throw(FilterError);
      });
    });

    it('caps the custom period at 366 days', () => {
      const from = '2025-09-01T00:00:00.000Z';
      const at366 = new Date(Date.parse(from) + 366 * DAY).toISOString();

      expect(parseFilters({ from, to: at366 }).range.toMs).to.equal(Date.parse(at366));
      expect(() =>
        parseFilters({ from, to: new Date(Date.parse(at366) + 1000).toISOString() }),
      ).to.throw(FilterError, '366 days');
    });
  });

  describe('counting', () => {
    const actions = [
      created('A', ago(3 * DAY)),
      moved('A', ago(2 * HOUR), 'Ready for Testing', 'Done'),
      created('B', ago(6 * HOUR)),
      moved('B', ago(4 * HOUR), 'Ready for Development', 'Done'),
      created('D', ago(40 * HOUR)),
      moved('D', ago(30 * HOUR), 'Ready for Testing', 'Tested by User'),
    ];

    it('gives the same answer as before when nothing is filtered', () => {
      const plain = compute({ actions, now: NOW, since: ago(65 * DAY) });

      expect(
        compute({ actions, now: NOW, since: ago(65 * DAY), range: null, cardIds: null }),
      ).to.deep.equal(plain);
      expect(plain.periods.map((item) => item.key)).to.deep.equal(['24h', '7d', '30d']);
      expect(reachOf(NOW)).to.deep.equal({ from: new Date(NOW.getTime() - 60 * DAY), to: null });
    });

    it('counts only the actions on the cards that passed the filters', () => {
      const day = period(compute({ actions, now: NOW, cardIds: new Set(['A']) }), '24h');

      expect(day.current).to.include({ entered: 0, completed: 1, testingAccepted: 1 });
      expect(day.current.medianSecondsToDone).to.equal(70 * 3600);
      expect(day.previous).to.include({ entered: 0, completed: 0 });

      // Nothing passed: everything is zero, not unfiltered.
      const none = period(compute({ actions, now: NOW, cardIds: new Set() }), '7d');
      expect(none.current).to.include({ entered: 0, completed: 0, testingAccepted: 0 });
    });

    it('counts one custom period against the one of the same length before it', () => {
      const range = { fromMs: NOW.getTime() - 36 * HOUR, toMs: NOW.getTime() - 3 * HOUR };
      const result = compute({ actions, now: NOW, range });

      expect(result.now).to.equal(NOW.toISOString());
      expect(result.periods).to.have.length(1);

      const [custom] = result.periods;

      expect(custom.key).to.equal('custom');
      expect(custom.seconds).to.equal(33 * 3600);
      expect(custom.current.from).to.equal(ago(36 * HOUR));
      expect(custom.current.to).to.equal(ago(3 * HOUR));
      expect(custom.previous.from).to.equal(ago(69 * HOUR));
      expect(custom.previous.to).to.equal(ago(36 * HOUR));
      // B entered and was done inside it, D was done inside it; A's
      // completion two hours ago is after its end.
      expect(custom.current).to.include({ entered: 1, completed: 2, testingAccepted: 1 });
      // D entered 40 h ago, inside the previous period; A, 72 h ago, before it.
      expect(custom.previous).to.include({ entered: 1, completed: 0 });
      expect(reachOf(NOW, range)).to.deep.equal({
        from: new Date(NOW.getTime() - 69 * HOUR),
        to: new Date(NOW.getTime() - 3 * HOUR),
      });
    });
  });
});
