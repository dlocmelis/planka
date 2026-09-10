/* eslint-disable import/no-extraneous-dependencies */
// `express` and `rttc` are transitive dependencies of `sails`, not declared ones. They are
// required here on purpose: the regression these tests pin is a crash inside rttc, triggered
// by express's own query parser, so asserting against stand-ins would pin nothing.
const express = require('express');
const rttc = require('rttc');
/* eslint-enable import/no-extraneous-dependencies */

const { expect } = require('chai');

const { globals } = require('../../config/globals');

// `api/controllers/cards/index.js` calls lodash through the `_` global that Sails installs at
// lift. These tests do not lift, so provide it before requiring the action -- and take it from
// `config/globals.js`, because WHICH lodash it is decides the answer here: `isBefore()` gates
// the cursor on `_.isPlainObject()`, and that has to be true for the null-prototype objects
// express 4.22.0 hands over. (It is for both lodash 4 and the `@sailshq/lodash` 3.10 fork sails
// falls back to, but pinning to the same module production uses keeps it that way.)
if (typeof global._ === 'undefined') {
  global._ = globals._;
}

const { withObjectPrototypes, normalizeQuery } = require('../../utils/normalize-query');
const cardsIndexAction = require('../../api/controllers/cards/index');

/**
 * Ask a real express 4 app (the version in the lockfile) to parse a query string, exactly the
 * way a request to the API would. This is what produces the null-prototype objects that
 * express 4.22.0's CVE-2024-51999 fix introduced.
 * @param {string} queryString Query string, without the leading `?`.
 * @param {Function[]} middlewares Middleware to run before the handler.
 * @returns {Promise<any>} The value of `req.query` as the route handler saw it.
 */
const parseQueryThroughExpress = (queryString, middlewares = []) =>
  new Promise((resolve, reject) => {
    const app = express();
    app.set('query parser', 'extended');

    middlewares.forEach((middleware) => app.use(middleware));

    let seen;
    app.get('/probe', (req, res) => {
      seen = req.query;
      res.status(204).end();
    });

    const server = app.listen(0, async () => {
      try {
        await fetch(`http://127.0.0.1:${server.address().port}/probe?${queryString}`);
        resolve(seen);
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });

const CURSOR_QUERY_STRING =
  'before[listChangedAt]=2024-01-01T00%3A00%3A00.000Z&before[id]=1357158568008091264';

// What the only over-HTTP caller of this endpoint actually puts on the wire: Go's
// `url.Values.Encode()` percent-encodes the brackets too
// (setl/data/core/support/planka.go, `(*PlankaClient).ArchivedCards`).
const PERCENT_ENCODED_CURSOR_QUERY_STRING =
  'before%5BlistChangedAt%5D=2024-01-01T00%3A00%3A00.000Z&before%5Bid%5D=1357158568008091264';

describe('normalize-query', () => {
  describe('the express 4.22.0 behaviour this exists for', () => {
    it('should hand bracketed query parameters over as null-prototype objects', async () => {
      const query = await parseQueryThroughExpress(CURSOR_QUERY_STRING);

      expect(Object.getPrototypeOf(query.before)).to.be.equal(null);
      expect(Object.keys(query.before)).to.have.members(['listChangedAt', 'id']);
    });

    it("should make rttc.validate('json', ...) throw on such an object", async () => {
      const query = await parseQueryThroughExpress(CURSOR_QUERY_STRING);

      expect(() => rttc.validate('json', query.before)).to.throw(/reading 'name'/);
    });
  });

  describe('#withObjectPrototypes(value)', () => {
    it('should rebuild a null-prototype object as an ordinary object, keeping its data', () => {
      const source = Object.create(null);
      source.listChangedAt = '2024-01-01T00:00:00.000Z';
      source.id = '1357158568008091264';

      const result = withObjectPrototypes(source);

      expect(Object.getPrototypeOf(result)).to.be.equal(Object.prototype);
      expect(result).to.be.eql({
        listChangedAt: '2024-01-01T00:00:00.000Z',
        id: '1357158568008091264',
      });
    });

    it('should rebuild null-prototype objects nested inside ordinary objects and arrays', () => {
      const nested = Object.create(null);
      nested.deep = 'value';

      const result = withObjectPrototypes({ list: [nested], direct: nested });

      expect(Object.getPrototypeOf(result.list[0])).to.be.equal(Object.prototype);
      expect(Object.getPrototypeOf(result.direct)).to.be.equal(Object.prototype);
      expect(result).to.be.eql({ list: [{ deep: 'value' }], direct: { deep: 'value' } });
      expect(result.list).to.be.an('array');
    });

    it('should return the very same reference when nothing needs rebuilding', () => {
      const source = { search: 'text', userIds: ['1', '2'] };

      expect(withObjectPrototypes(source)).to.be.equal(source);
      expect(withObjectPrototypes(source).userIds).to.be.equal(source.userIds);
    });

    it('should pass primitives, null and undefined through untouched', () => {
      expect(withObjectPrototypes('text')).to.be.equal('text');
      expect(withObjectPrototypes(7)).to.be.equal(7);
      expect(withObjectPrototypes(null)).to.be.equal(null);
      expect(withObjectPrototypes(undefined)).to.be.equal(undefined);
    });

    it('should drop a `__proto__` key instead of writing it to the prototype', () => {
      // express 4.22.0's parser already discards `__proto__` (see the test below), so this is
      // defence in depth: even handed one, we must not assign it onto an ordinary object,
      // because that assignment *is* the prototype write CVE-2024-51999 is about.
      const source = Object.create(null);
      const payload = Object.create(null);
      payload.polluted = 'yes';
      source.__proto__ = payload; // eslint-disable-line no-proto
      source.safe = 'ok';

      const result = withObjectPrototypes(source);

      expect(Object.getPrototypeOf(result)).to.be.equal(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).to.be.equal(false);
      expect(result.polluted).to.be.equal(undefined);
      expect({}.polluted).to.be.equal(undefined);
      expect(result.safe).to.be.equal('ok');
    });

    it('should never see a `__proto__` key from the express parser in the first place', async () => {
      const query = await parseQueryThroughExpress('__proto__[polluted]=yes&safe=ok');

      expect(Object.getOwnPropertyNames(query)).to.be.eql(['safe']);
      expect(withObjectPrototypes(query)).to.be.eql({ safe: 'ok' });
    });

    it('should stop recursing at the depth backstop', () => {
      let source = Object.create(null);
      source.leaf = 'value';

      for (let index = 0; index < 40; index += 1) {
        const wrapper = Object.create(null);
        wrapper.next = source;
        source = wrapper;
      }

      expect(() => withObjectPrototypes(source)).to.not.throw();
    });
  });

  describe('#normalizeQuery(req, res, next)', () => {
    it('should replace a query carrying null-prototype objects and call next', async () => {
      const query = await parseQueryThroughExpress(CURSOR_QUERY_STRING, [normalizeQuery]);

      expect(Object.getPrototypeOf(query.before)).to.be.equal(Object.prototype);
      expect(query.before).to.be.eql({
        listChangedAt: '2024-01-01T00:00:00.000Z',
        id: '1357158568008091264',
      });
    });

    it("should leave rttc.validate('json', ...) working again for the cursor", async () => {
      const query = await parseQueryThroughExpress(CURSOR_QUERY_STRING, [normalizeQuery]);

      expect(() => rttc.validate('json', query.before)).to.not.throw();
    });

    it('should leave a query with no bracketed parameter alone', async () => {
      const query = await parseQueryThroughExpress('search=text&userIds=1,2', [normalizeQuery]);

      expect(query).to.be.eql({ search: 'text', userIds: '1,2' });
    });

    it('should still rebuild the query object itself, because express makes that null-prototype too', async () => {
      // `plainObjects: true` applies to the query as a whole, not only to bracketed parameters,
      // so this middleware copies `req.query` on EVERY request. Pinned because the cost of the
      // middleware is exactly this copy, and a future reader should not have to measure it.
      const raw = await parseQueryThroughExpress('search=text');
      const normalized = await parseQueryThroughExpress('search=text', [normalizeQuery]);

      expect(Object.getPrototypeOf(raw)).to.be.equal(null);
      expect(Object.getPrototypeOf(normalized)).to.be.equal(Object.prototype);
    });

    it('should keep nested values by identity, so the copy stays shallow', () => {
      const source = Object.create(null);
      source.userIds = ['1', '2'];
      source.nested = { deep: 'value' };

      const result = withObjectPrototypes(source);

      expect(result).to.not.be.equal(source);
      expect(result.userIds).to.be.equal(source.userIds);
      expect(result.nested).to.be.equal(source.nested);
    });
  });

  describe('wiring in sails.config.http', () => {
    // Required lazily: `config/http.js` pulls in `sails`, which is slow, and nothing above
    // needs it.
    // eslint-disable-next-line global-require
    const { http } = require('../../config/http');

    it('should register `normalizeQuery` as an HTTP middleware', () => {
      expect(http.middleware.normalizeQuery).to.be.equal(normalizeQuery);
    });

    it('should run it before the router', () => {
      const { order } = http.middleware;

      expect(order).to.include('normalizeQuery');
      expect(order.indexOf('normalizeQuery')).to.be.below(order.indexOf('router'));
    });

    it('should keep every sails default middleware in the order', () => {
      // Sails throws E_INVALID_HTTP_CONFIG at lift for a custom middleware that is missing from
      // the order, so spelling the order out means we own keeping it complete.
      expect(http.middleware.order).to.include.members([
        'cookieParser',
        'session',
        'bodyParser',
        'compress',
        'poweredBy',
        'router',
        'www',
        'favicon',
      ]);
    });

    it('should have every custom middleware it declares present in the order', () => {
      const customNames = Object.keys(http.middleware).filter(
        (name) => name !== 'order' && typeof http.middleware[name] === 'function',
      );

      customNames.forEach((name) => expect(http.middleware.order).to.include(name));
    });

    /**
     * Run sails' own http hook `configure()` against a config, with a stub sails object. That
     * function is the real gate this config has to clear at lift: it throws
     * E_INVALID_HTTP_CONFIG when a custom middleware is missing from `middleware.order`, or
     * when the order names something that is not a function (sails 1.5.17,
     * lib/hooks/http/index.js). Asserting against it rather than against a hand-copied list
     * matters because a wrong order here is not a 500 on one route -- it is planka not
     * starting at all, which takes the whole board down.
     * @param {object} httpConfig A value for `sails.config.http`.
     * @returns {string[]} The middleware order sails settled on.
     */
    const runSailsHttpConfigure = (httpConfig) => {
      // eslint-disable-next-line global-require
      const defineHttpHook = require('sails/lib/hooks/http');

      const stubSails = {
        config: {
          appPath: __dirname,
          ssl: {},
          paths: { public: '.tmp/public' },
          http: httpConfig,
        },
        log: { debug: () => {} },
      };

      const hook = defineHttpHook(stubSails);
      stubSails.hooks = { http: { defaults: hook.defaults } };

      hook.configure();

      return stubSails.config.http.middleware.order;
    };

    it("should pass sails' own lift-time http config validation", () => {
      expect(runSailsHttpConfigure(http)).to.include('normalizeQuery');
    });

    it('should fail that same validation if `normalizeQuery` is dropped from the order', () => {
      const withoutTheEntry = {
        ...http,
        middleware: {
          ...http.middleware,
          order: http.middleware.order.filter((name) => name !== 'normalizeQuery'),
        },
      };

      expect(() => runSailsHttpConfigure(withoutTheEntry)).to.throw(/normalizeQuery/);
    });
  });

  describe('GET /api/lists/:listId/cards `before` input', () => {
    const { before } = cardsIndexAction.inputs;

    it("should be declared `type: 'ref'`, not `type: 'json'`", () => {
      // A `json` input is validated by rttc *before* `custom` runs, and rttc 10.0.1 throws on a
      // null-prototype object -- which is a 500 for every cursor page of an endless list.
      expect(before.type).to.be.equal('ref');
    });

    it('should still validate the cursor with `custom`', () => {
      expect(before.custom).to.be.a('function');
    });

    it('should accept a null-prototype cursor from express through its declared type', async () => {
      const query = await parseQueryThroughExpress(CURSOR_QUERY_STRING);

      expect(() => rttc.validate(before.type, query.before)).to.not.throw();
      expect(before.custom(rttc.validate(before.type, query.before))).to.be.equal(true);
    });

    it('should reject a malformed cursor with `custom` rather than crashing', async () => {
      const query = await parseQueryThroughExpress(
        'before[listChangedAt]=2024-01-01T00%3A00%3A00.000Z&before[id]=not-an-id',
      );

      const validated = rttc.validate(before.type, query.before);

      expect(before.custom(validated)).to.be.equal(false);
    });

    it('should accept the percent-encoded brackets the Go reconciler sends', async () => {
      const query = await parseQueryThroughExpress(PERCENT_ENCODED_CURSOR_QUERY_STRING, [
        normalizeQuery,
      ]);

      expect(query.before).to.be.eql({
        listChangedAt: '2024-01-01T00:00:00.000Z',
        id: '1357158568008091264',
      });
      expect(before.custom(rttc.validate(before.type, query.before))).to.be.equal(true);
    });

    it('should reject a cursor that is missing a half', async () => {
      const query = await parseQueryThroughExpress('before[id]=1357158568008091264');

      expect(before.custom(rttc.validate(before.type, query.before))).to.be.equal(false);
    });
  });
});
