/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

// A cycle in the dependency graph is the one bad state the product cannot get
// itself out of: every card in the loop waits for another card in the loop, so
// none of them is ever released, and unlike a duplicate row there is no button
// anywhere that clears it.
//
// helpers/card-dependencies/create-one.js already walks the graph before it
// writes, but that walk is check-then-act: two requests can each read a graph
// with no loop in it and then both insert, and together close one. Serialising
// them in the application would only hold within one process, and Planka runs
// behind whatever number of workers the operator chose.
//
// So the rule is put where the rows are. The trigger below takes an advisory
// lock that every dependency INSERT contends for, which means the walk it then
// runs sees every link that is going to exist before it — the second request
// waits for the first to commit and then finds the loop the first one created.
// The lock is transaction-scoped, so it is released by the commit or the
// rollback and there is nothing to leak.
//
// The application check stays: it is the one that produces a 422 with a
// sentence in it, and it is the only check the in-memory test datastore has.
// This is the backstop underneath it.

// The tag the application matches on to turn this into `dependencyWouldCreateCycle`
// rather than a 500 — keep it in step with CYCLE_GUARD_TAG in
// api/helpers/card-dependencies/create-one.js.
const CYCLE_GUARD_TAG = 'card_dependency_cycle';

exports.up = async (knex) => {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION card_dependency_reject_cycle() RETURNS trigger AS $$
    DECLARE
      closes_cycle boolean;
    BEGIN
      -- Every dependency insert queues behind this one lock, so the walk below
      -- runs against a graph nobody is concurrently adding to. Transaction
      -- scoped: released on COMMIT or ROLLBACK, whichever comes.
      PERFORM pg_advisory_xact_lock(4919, 1);

      IF NEW.card_id = NEW.depends_on_card_id THEN
        RAISE EXCEPTION '${CYCLE_GUARD_TAG}: a card cannot depend on itself'
          USING ERRCODE = 'check_violation';
      END IF;

      -- "What does the blocker itself wait for, transitively?" UNION rather
      -- than UNION ALL, so a loop that somehow already exists in the data is
      -- walked once and the query still terminates.
      WITH RECURSIVE reachable(card_id) AS (
        SELECT NEW.depends_on_card_id
        UNION
        SELECT d.depends_on_card_id
          FROM card_dependency d
          JOIN reachable r ON d.card_id = r.card_id
      )
      SELECT EXISTS (SELECT 1 FROM reachable WHERE card_id = NEW.card_id)
        INTO closes_cycle;

      IF closes_cycle THEN
        RAISE EXCEPTION '${CYCLE_GUARD_TAG}: card % already waits for card %',
          NEW.depends_on_card_id, NEW.card_id
          USING ERRCODE = 'check_violation';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER card_dependency_no_cycle
      BEFORE INSERT OR UPDATE OF card_id, depends_on_card_id ON card_dependency
      FOR EACH ROW EXECUTE PROCEDURE card_dependency_reject_cycle();
  `);
};

exports.down = async (knex) => {
  await knex.raw('DROP TRIGGER IF EXISTS card_dependency_no_cycle ON card_dependency;');
  await knex.raw('DROP FUNCTION IF EXISTS card_dependency_reject_cycle();');
};
