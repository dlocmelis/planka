const { expect } = require('chai');

const { classify, compute, missingCreations } = require('../../utils/pipeline-statistics');

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
