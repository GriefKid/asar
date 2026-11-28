const test = require('node:test');
const assert = require('node:assert/strict');
const { moveFolder, removeFolder, seed } = require('../src/shared/collections');

test('folders can move to root or a different branch, and cannot contain themselves', () => {
  const folders = [{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: null }];
  assert.equal(moveFolder(folders, 'a', 'b'), false);
  assert.equal(moveFolder(folders, 'a', 'a'), false);
  assert.equal(moveFolder(folders, 'a', 'missing'), false);
  assert.equal(moveFolder(folders, 'b', 'c'), true);
  assert.equal(folders[1].parentId, 'c');
  assert.equal(moveFolder(folders, 'b', null), true);
});

test('old collections migrate once and removing a folder keeps its children and items', () => {
  const tree = { folders: [], items: {}, seeded: [] };
  const old = [{ id: '1', name: 'Music', songs: [{ path: 'Local song.wav' }] }];
  seed(tree, old, 'songs');
  seed(tree, old, 'songs');
  assert.equal(tree.folders.length, 1);
  assert.equal(tree.items['item:Local song.wav'], 'legacy:1');
  tree.folders.push({ id: 'child', parentId: 'legacy:1' });
  assert.equal(removeFolder(tree, 'legacy:1'), true);
  assert.equal(tree.folders[0].parentId, null);
  assert.equal(tree.items['item:Local song.wav'], null);
  seed(tree, old, 'songs');
  assert.equal(tree.folders.length, 1);
});
