const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { selectProfilePath } = require('../src/shared/profile-path.cjs');

test('renaming preserves a legacy installation profile and respects custom storage', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-profile-'));
  const expected = path.join(dir, 'asar-desktop');
  const old = path.join(dir, 'mylife');
  const populate = root => {
    const data = path.join(root, 'Local Storage', 'leveldb');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'CURRENT'), 'test');
  };
  assert.equal(selectProfilePath(dir, expected), expected);
  populate(old);
  assert.equal(selectProfilePath(dir, expected), old);
  assert.equal(selectProfilePath(dir, path.join(dir, 'sandbox')), path.join(dir, 'sandbox'));
  populate(expected);
  assert.equal(selectProfilePath(dir, expected), expected);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
});
