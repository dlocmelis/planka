/**
 * HTTP Server Settings
 * (sails.config.http)
 *
 * Configuration for the underlying HTTP server in Sails.
 * (for additional recommended settings, see `config/env/production.js`)
 *
 * For more information on configuration, check out:
 * https://sailsjs.com/config/http
 */

const serveStatic = require('serve-static');
const sails = require('sails');

const { normalizeQuery } = require('../utils/normalize-query');

module.exports.http = {
  /**
   *
   * Sails/Express middleware to run for every HTTP request.
   * (Only applies to HTTP requests -- not virtual WebSocket requests.)
   *
   * https://sailsjs.com/documentation/concepts/middleware
   *
   */

  middleware: {
    /**
     *
     * The order in which middleware should be run for HTTP requests.
     * (This Sails app's routes are handled by the "router" middleware below.)
     *
     */
    // This is Sails 1.5.17's own default order (lib/hooks/http/index.js) with `normalizeQuery`
    // prepended -- it has to run before `router`, and there is no way to add a middleware name
    // without spelling the whole order out. An entry whose middleware is disabled or missing is
    // skipped by Sails with a verbose log, so listing `session` here is safe either way.
    order: [
      'normalizeQuery',
      'cookieParser',
      'session',
      'bodyParser',
      'compress',
      'poweredBy',
      'router',
      'www',
      'favicon',
    ],
    /**
     *
     * The body parser that will handle incoming multipart HTTP requests.
     *
     * https://sailsjs.com/config/http#?customizing-the-body-parser
     *
     */
    // bodyParser: (function _configureBodyParser(){
    //   var skipper = require('skipper');
    //   var middlewareFn = skipper({ strict: true });
    //   return middlewareFn;
    // })(),

    poweredBy: false,

    /**
     *
     * Rebuilds the null-prototype objects that express 4.22.0's query parser produces for
     * bracketed query parameters into ordinary objects, so that `rttc.validate()` -- and so
     * every action input declared `type: 'json'` -- does not throw a 500 before the action's
     * own validator runs. See `utils/normalize-query.js` for the full story.
     *
     */
    normalizeQuery,

    www(req, res, next) {
      const middleware = serveStatic(sails.config.paths.public, {
        maxAge: sails.config.http.cache,
        immutable: req.url.startsWith('/assets/'),
      });

      return middleware(req, res, next);
    },
  },
};
