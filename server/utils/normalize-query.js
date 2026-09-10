/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * Express 4.22.0 (the fix for CVE-2024-51999 / GHSA-pj86-cfqh-vqx6) changed its "extended"
 * query parser from `qs.parse(str, { allowPrototypes: true })` to
 * `qs.parse(str, { plainObjects: true })`. That stops a bracketed query parameter from ever
 * writing through to a prototype -- but it also means every bracketed query parameter now
 * arrives as a NULL-PROTOTYPE object.
 *
 * Sails' input validator does not survive that. `rttc.validate('json', <null-proto>)` reads
 * `v.constructor.name` (rttc 10.0.1, lib/helpers/types.js) to reject its RttcRefPlaceholder
 * sentinel, `constructor` is `undefined` on a null-prototype object, and the read throws
 * `Cannot read properties of undefined (reading 'name')` -- a 500, raised BEFORE the action's
 * own `custom` validator ever runs. rttc is dead upstream (10.0.1 is the newest release and
 * dates from 2022), so there is no version to upgrade to, and pinning express back below
 * 4.22.0 would reintroduce the CVE.
 *
 * So we restore the shape sails expects at the boundary instead: rebuild any null-prototype
 * object that came out of the query parser as an ordinary object, and keep express 4.22.0's
 * protection by refusing to copy a `__proto__` key across (assigning one onto an ordinary
 * object is exactly the prototype write the CVE fix exists to prevent).
 *
 * Cost, so that nobody has to measure it at 2am: the `plainObjects: true` parser returns a
 * null-prototype object for the query as a WHOLE, not only for bracketed parameters, so this
 * does rebuild `req.query` on every single request -- one shallow copy of a handful of strings.
 * Nested values are returned by identity when nothing beneath them needed rebuilding, so the
 * copy stays shallow for the requests that carry no bracketed parameter, which is almost all of
 * them.
 */

// qs stops nesting at depth 5; this is only a backstop against a pathological input.
const MAX_DEPTH = 16;

const hasNullPrototype = (value) => Object.getPrototypeOf(value) === null;

/**
 * Recursively rebuild null-prototype objects as ordinary objects.
 * @param {any} value Value from the express query parser.
 * @param {number} depth Current recursion depth.
 * @returns {any} The value, or an equivalent value with ordinary prototypes. Returns the
 *   original reference when no null-prototype object was found beneath it.
 */
const withObjectPrototypes = (value, depth = 0) => {
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    let changed = false;

    const items = value.map((item) => {
      const normalizedItem = withObjectPrototypes(item, depth + 1);

      if (normalizedItem !== item) {
        changed = true;
      }

      return normalizedItem;
    });

    return changed ? items : value;
  }

  const isNullPrototype = hasNullPrototype(value);
  const result = {};
  let changed = isNullPrototype;

  Object.keys(value).forEach((key) => {
    // Never copy `__proto__` onto an ordinary object: that assignment would set the object's
    // prototype, which is the write express 4.22.0 stopped allowing. Dropping it keeps the
    // key out of reach exactly as the pre-4.22.0 `allowPrototypes` parser did.
    if (key === '__proto__') {
      changed = true;
      return;
    }

    const normalizedItem = withObjectPrototypes(value[key], depth + 1);

    if (normalizedItem !== value[key]) {
      changed = true;
    }

    result[key] = normalizedItem;
  });

  return changed ? result : value;
};

/**
 * Sails/Express middleware that normalizes `req.query` for every HTTP request.
 * Wired first in `sails.config.http.middleware.order` (see `config/http.js`).
 */
const normalizeQuery = (req, res, next) => {
  const normalized = withObjectPrototypes(req.query);

  if (normalized !== req.query) {
    req.query = normalized;
  }

  return next();
};

module.exports = {
  withObjectPrototypes,
  normalizeQuery,
};
