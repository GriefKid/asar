const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBackup, collect } = require('../src/shared/backup');

test('backup includes local cultural data and never includes key or session settings', () => {
  const slots = new Map([
    ['asar-library', '[]'], ['book-reader', '{"highlights":[]}'], ['asar-writer-docs', '[]'],
    ['asar-actual-events', '{}'], ['asar-layouts', '{}'], ['asar-collections', '{}'],
    ['claude-api-key', 'private'], ['asar-settings', '{"tmdb-key":"private"}'], ['sb-session', 'private']
  ]);
  const storage = { length: slots.size, key: index => [...slots.keys()][index], getItem: key => slots.get(key) };
  const snapshot = collect(storage);
  assert.deepEqual(Object.keys(snapshot), [...slots.keys()].slice(0, 6));
  assert.deepEqual(parseBackup({ schema: 'asar-backup', version: 2, storage: snapshot }), snapshot);
  assert.deepEqual(parseBackup({ library: [], events: {}, settings: { 'tmdb-key': 'private' } }), { 'asar-library':'[]', 'asar-events':'{}' });
  assert.throws(() => parseBackup({ schema:'asar-backup', version:2, storage:{ 'asar-library':'{}' } }));
});
