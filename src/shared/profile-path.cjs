const path = require('node:path');
const fs = require('node:fs');

function selectProfilePath(appData, activePath) {
  // Preserve profiles created by the original installer at the same location.
  // Paths supplied by an isolated test or a custom deployment take priority.
  const expected = path.join(appData, 'asar-desktop');
  if (path.resolve(activePath) !== path.resolve(expected)) return activePath;
  if (fs.existsSync(path.join(expected, 'Local Storage', 'leveldb', 'CURRENT'))) return activePath;
  const previous = ['mylife', 'Lifestyle'].map(name => path.join(appData, name))
    .find(directory => fs.existsSync(path.join(directory, 'Local Storage', 'leveldb', 'CURRENT')));
  return previous || activePath;
}

module.exports = { selectProfilePath };
