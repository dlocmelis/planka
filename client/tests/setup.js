// Config constants read browser globals at import time.
// Only shim in the node environment; jsdom-based tests already provide window.
if (typeof global.window === 'undefined') {
  global.window = {};
}
