/**
 * Seed Function
 * (sails.config.bootstrap)
 *
 * A function that runs just before your Sails app gets lifted.
 * > Need more flexibility?  You can also create a hook.
 *
 * For more information on seeding your app with fake data, check out:
 * https://sailsjs.com/config/bootstrap
 */

module.exports.bootstrap = async () => {
  // Resolve the voice chat configuration here rather than leaving it to
  // whichever request first needs it (see docs/bot-chat-voice.md).
  //
  // It is the one knob-set in this app that can be HALF configured: a typo in
  // one optional value leaves that half off with an error in the log instead of
  // taking the app down, and an outgoing allowlist missing the provider's
  // hostname leaves it looking configured and failing every turn. Both are
  // written by this call, and an operator goes looking for them in the startup
  // log — not at whatever hour the first bootstrap request happened to arrive.
  sails.helpers.voice.getConfig();

  // By convention, this is a good place to set up fake data during development.
  //
  // For example:
  // ```
  // // Set up fake development data (or if we already have some, avast)
  // if (await User.count() > 0) {
  //   return;
  // }
  //
  // await User.createEach([
  //   { emailAddress: 'ry@example.com', fullName: 'Ryan Dahl', },
  //   { emailAddress: 'rachael@example.com', fullName: 'Rachael Shaw', },
  //   // etc.
  // ]);
  // ```
};
