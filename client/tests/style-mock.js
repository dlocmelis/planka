// Maps SCSS module imports to an identity proxy: `styles.someClass` -> 'someClass'
module.exports = new Proxy(
  {},
  {
    get: (target, key) => {
      if (key === '__esModule') {
        return false;
      }

      return key;
    },
  },
);
