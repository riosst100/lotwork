const path = require('path');

// When bundled with pkg, __dirname points into the read-only snapshot filesystem.
// Writable data (projects.json, logs, pid, Caddyfile) must live next to the real exe instead.
const isPkg = typeof process.pkg !== 'undefined';

const appRoot = __dirname;
const dataRoot = isPkg ? path.dirname(process.execPath) : __dirname;

module.exports = {
  appRoot,
  dataDir: path.join(dataRoot, 'data'),
  publicDir: path.join(appRoot, 'public'),
};
