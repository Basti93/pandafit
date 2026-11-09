// Preload for ESLint: typescript-eslint needs the JS compiler API, which TypeScript 7 (native) does not ship.
// Route its `typescript` requires to the TypeScript 6 copy (devDependency `eslint-typescript`). Only linting uses it; tsc stays 7.
const Module = require('node:module');
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return orig.call(this, request === 'typescript' ? 'eslint-typescript' : request, ...rest);
};
