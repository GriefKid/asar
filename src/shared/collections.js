'use strict';

const AsarCollections = (() => {
  const unfiledId = 'asar-unfiled';

  function nativeId(folder) {
    return folder ? folder.id.replace(/^legacy:/, '') : unfiledId;
  }

  function nativeFolder(folders, id) {
    return folders.find(folder => nativeId(folder) === id);
  }

  function ensureNative(collections, field, folder) {
    const id = nativeId(folder);
    const existing = collections.find(collection => collection.id === id);
    if (existing) return existing;
    const collection = { id, name: folder?.title || 'بدون پوشه', [field]: [], open: true };
    collections.push(collection);
    return collection;
  }

  function moveMedia(collections, field, id, folder, fromCollection, previousFolder) {
    const possibleSources = [fromCollection, nativeId(previousFolder)];
    const candidates = collections.filter(collection => collection[field]?.some(item => item.path === id));
    const source = possibleSources.map(candidate => candidates.find(collection => collection.id === candidate)).find(Boolean)
      || candidates.find(collection => collection.id !== nativeId(folder)) || candidates[0];
    if (!source) return false;
    const target = ensureNative(collections, field, folder);
    target.open = true;
    if (target !== source) {
      const position = source[field].findIndex(item => item.path === id);
      const [item] = source[field].splice(position, 1);
      if (!target[field].some(existing => existing.path === id)) target[field].push(item);
    }
    return true;
  }

  function nativeRows(folders, collections) {
    const group = Map.groupBy(folders, folder => folder.parentId || null);
    const byId = new Map(collections.map(collection => [collection.id, collection]));
    const seen = new Set();
    const rows = [];
    function branch(parentId, depth) {
      for (const folder of group.get(parentId) || []) {
        if (seen.has(folder.id)) continue;
        seen.add(folder.id);
        const id = nativeId(folder);
        const collection = byId.get(id);
        if (collection) {
          rows.push({ collection, depth });
          byId.delete(id);
        }
        branch(folder.id, depth + 1);
      }
    }
    branch(null, 0);
    for (const collection of byId.values()) rows.push({ collection, depth: 0 });
    return rows;
  }

  function canMoveFolder(folders, id, parentId) {
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    if (!byId.has(id) || (parentId && !byId.has(parentId))) return false;
    const seen = new Set([id]);
    for (let node = byId.get(parentId); node; node = byId.get(node.parentId)) {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
    }
    return true;
  }

  function moveFolder(folders, id, parentId) {
    if (!canMoveFolder(folders, id, parentId)) return false;
    folders.find(folder => folder.id === id).parentId = parentId || null;
    return true;
  }

  function removeFolder(tree, id) {
    const folder = tree.folders.find(item => item.id === id);
    if (!folder) return false;
    for (const child of tree.folders) if (child.parentId === id) child.parentId = folder.parentId;
    for (const [key, parent] of Object.entries(tree.items)) if (parent === id) tree.items[key] = folder.parentId;
    tree.folders = tree.folders.filter(item => item.id !== id);
    return true;
  }

  function seed(tree, collections, field) {
    for (const collection of collections) {
      const match = nativeFolder(tree.folders, collection.id);
      const id = match?.id || 'legacy:' + collection.id;
      if (!match && collection.id !== unfiledId && !tree.seeded.includes(id)) {
        tree.seeded.push(id);
        tree.folders.push({ id, title: collection.name || collection.title || 'مجموعه', parentId: null });
      }
      if (collection.id !== unfiledId && !tree.folders.some(folder => folder.id === id)) continue;
      for (const item of collection[field] || []) {
        const key = 'item:' + item.path;
        if (!Object.hasOwn(tree.items, key)) tree.items[key] = collection.id === unfiledId ? null : id;
      }
    }
  }

  return { nativeId, nativeFolder, ensureNative, moveMedia, nativeRows, canMoveFolder, moveFolder, removeFolder, seed };
})();

if (typeof module !== 'undefined') module.exports = AsarCollections;
