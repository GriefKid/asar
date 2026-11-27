'use strict';

const AsarCollections = (() => {
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
      const id = 'legacy:' + collection.id;
      if (tree.seeded.includes(id)) continue;
      tree.seeded.push(id);
      tree.folders.push({ id, title: collection.name || collection.title || 'مجموعه', parentId: null });
      for (const item of collection[field] || []) {
        const key = 'item:' + item.path;
        if (!Object.hasOwn(tree.items, key)) tree.items[key] = id;
      }
    }
  }

  return { canMoveFolder, moveFolder, removeFolder, seed };
})();

if (typeof module !== 'undefined') module.exports = AsarCollections;
