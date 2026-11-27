'use strict';

(() => {
  const key = 'asar-collections';
  const mediaType = 'application/x-asar-collection-item';
  const page = location.pathname.split('/').at(-2);
  const source = window.asarCollectionSource;
  if (!source) return;
  const mount = document.querySelector(page === 'main-app' ? '#section-library .lib-header' : '.sidebar');
  if (!mount) return;

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const panel = el('details', '', 'asar-collection-tree');
  panel.id = 'asar-collection-tree';
  const summary = el('summary', 'مجموعه‌ها');
  const actions = el('div', '', 'asar-collection-actions');
  const name = el('input');
  name.maxLength = 70;
  name.placeholder = 'نام مجموعه';
  name.setAttribute('aria-label', 'نام مجموعه');
  const target = el('select');
  target.setAttribute('aria-label', 'مجموعهٔ والد یا مقصد');
  const rows = el('div', '', 'asar-collection-rows');
  const status = el('small', '', 'asar-collection-status');
  status.setAttribute('role', 'status');
  actions.append(name, target);
  panel.append(summary, actions, status, rows);
  const openFolders = new Set();
  let selected = null;
  let tree;
  let snapshot = '';
  let hoverTimer;
  let hoverNode;
  const legacy = source.legacy;

  function readAll() {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
  }

  function currentTree() {
    const all = readAll();
    return all[page] || { folders: [], items: {}, seeded: [] };
  }

  function save() {
    const all = readAll();
    all[page] = tree;
    localStorage.setItem(key, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent('asar-store', { detail: key }));
  }

  function button(text, cb, parent) {
    const node = el('button', text);
    node.type = 'button';
    node.addEventListener('click', cb);
    parent.append(node);
    return node;
  }

  function update(change) {
    tree = currentTree();
    if (!change()) return false;
    save();
    render();
    source.changed?.();
    return true;
  }

  function move(item, destination) {
    if (!item || item.scope !== page) return;
    update(() => {
      const targetFolder = tree.folders.find(folder => folder.id === destination);
      if (destination && !targetFolder) return false;
      if (item.type === 'folder') {
        if (!AsarCollections.moveFolder(tree.folders, item.id, destination)) {
          status.textContent = 'امکان قراردادن مجموعه درون خودش یا زیرمجموعه‌اش وجود ندارد.';
          return false;
        }
      } else if (item.type === 'item' && source.items().some(record => String(record.id) === item.id)) {
        const key = 'item:' + item.id;
        const previousFolder = tree.folders.find(folder => folder.id === tree.items[key]);
        if (legacy && !AsarCollections.moveMedia(legacy.list(), legacy.field, item.id, targetFolder, item.origin, previousFolder)) return false;
        tree.items[key] = destination || null;
      } else return false;
      if (destination) openFolders.add(destination);
      status.textContent = 'جابه‌جا شد.';
      return true;
    });
  }

  function startDrag(event, type, id, origin) {
    if (id === undefined || id === null || !event.dataTransfer) return;
    selected = { scope: page, type, id: String(id), origin };
    event.dataTransfer.setData(mediaType, JSON.stringify(selected));
    event.dataTransfer.effectAllowed = 'move';
    if (!panel.open) requestAnimationFrame(() => { if (selected) panel.open = true; });
  }

  function dragSource(node, type, id) {
    node.draggable = true;
    node.addEventListener('dragstart', event => {
      event.stopPropagation();
      startDrag(event, type, id);
    });
  }

  function clearHover() {
    clearTimeout(hoverTimer);
    hoverNode?.classList.remove('asar-drop');
    hoverNode = null;
  }

  function dragOver(event, node, group) {
    const data = event.dataTransfer;
    if (!data) return;
    const internal = data.types.includes(mediaType);
    const files = source.importFiles && data.types.includes('Files');
    if (!internal && !files) return;
    event.preventDefault();
    event.stopPropagation();
    data.dropEffect = internal ? 'move' : 'copy';
    if (hoverNode === node) return;
    clearHover();
    hoverNode = node;
    node.classList.add('asar-drop');
    if (group && !group.open) hoverTimer = setTimeout(() => { group.open = true; }, 450);
  }

  async function drop(event, parentId) {
    const data = event.dataTransfer;
    if (!data) return;
    const raw = data.getData(mediaType);
    const files = source.importFiles && Array.from(data.files || []);
    if (!raw && !files?.length) return;
    event.preventDefault();
    event.stopPropagation();
    clearHover();
    try {
      if (raw) {
        move(JSON.parse(raw), parentId);
      } else {
        const paths = files.filter(file => file.path && source.fileType.test(file.name)).map(file => file.path);
        if (!paths.length) { status.textContent = 'این پوشه فایل سازگار دریافت نکرد.'; return; }
        const folder = currentTree().folders.find(item => item.id === parentId);
        if (parentId && !folder) return;
        if (folder) openFolders.add(folder.id);
        await source.importFiles([...new Set(paths)], folder);
        update(() => {
          for (const path of paths) {
            if (source.items().some(record => record.id === path)) tree.items['item:' + path] = parentId;
          }
          status.textContent = 'فایل‌ها اضافه شدند.';
          return true;
        });
      }
    } catch { status.textContent = 'جابه‌جایی انجام نشد.'; }
  }

  function dropTarget(node, parentId) {
    node.addEventListener('dragover', event => dragOver(event, node, node.parentElement));
    node.addEventListener('dragleave', event => { if (!node.contains(event.relatedTarget)) clearHover(); });
    node.addEventListener('drop', event => drop(event, parentId));
  }

  function addFolder() {
    const title = name.value.trim();
    if (!title) { name.focus(); return; }
    update(() => {
      const parentId = target.value || null;
      const folder = { id: globalThis.crypto.randomUUID(), title, parentId };
      tree.folders.push(folder);
      if (legacy) AsarCollections.ensureNative(legacy.list(), legacy.field, folder);
      if (parentId) openFolders.add(parentId);
      openFolders.add(folder.id);
      name.value = '';
      return true;
    });
  }

  button('ساخت مجموعه', addFolder, actions);
  name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addFolder(); } });
  button('انتقال انتخاب‌شده', () => move(selected, target.value), actions);
  button('تغییر نام', () => {
    const title = name.value.trim();
    if (selected?.type !== 'folder' || !title) { name.focus(); return; }
    update(() => {
      const folder = tree.folders.find(entry => entry.id === selected.id);
      if (!folder) return false;
      folder.title = title;
      const native = legacy?.list().find(collection => collection.id === AsarCollections.nativeId(folder));
      if (native) native.name = title;
      name.value = '';
      return true;
    });
  }, actions);
  button('حذف مجموعه', () => {
    if (selected?.type === 'folder') removeFolder(selected.id);
    selected = null;
  }, actions);
  dropTarget(summary, null);

  function removeFolder(id) {
    if (!confirm('مجموعه حذف شود؟ آثار و زیرمجموعه‌ها به سطح بالاتر منتقل می‌شوند.')) return false;
    return update(() => {
      const folder = tree.folders.find(entry => entry.id === id);
      if (!folder) return false;
      const collections = legacy?.list();
      const native = collections?.find(collection => collection.id === AsarCollections.nativeId(folder));
      if (native) {
        const parent = tree.folders.find(entry => entry.id === folder.parentId);
        for (const item of [...native[legacy.field]]) {
          AsarCollections.moveMedia(collections, legacy.field, item.path, parent, native.id, folder);
        }
        collections.splice(collections.indexOf(native), 1);
      }
      return AsarCollections.removeFolder(tree, id);
    });
  }

  function render() {
    snapshot = JSON.stringify(tree);
    const oldTarget = target.value;
    target.replaceChildren(new Option('سطح اصلی', ''));
    const folderIds = new Set(tree.folders.map(folder => folder.id));
    const items = new Map();
    for (const item of source.items()) {
      if (item.id === undefined || !item.title) continue;
      const id = String(item.id);
      if (!items.has(id)) items.set(id, item);
    }
    const grouped = Map.groupBy([...items], ([id]) => {
      const parent = tree.items['item:' + id];
      return folderIds.has(parent) ? parent : null;
    });
    const nesting = Map.groupBy(tree.folders, folder => folderIds.has(folder.parentId) ? folder.parentId : null);
    const shown = new Set();
    function branch(parent, node, level = 0) {
      for (const folder of nesting.get(parent) || []) {
        if (shown.has(folder.id) || level > 48) continue;
        shown.add(folder.id);
        target.add(new Option('  '.repeat(level) + folder.title, folder.id));
        const group = el('details', '', 'asar-tree-group');
        group.open = openFolders.has(folder.id);
        group.dataset.folderId = folder.id;
        const header = el('summary', folder.title);
        header.addEventListener('click', () => { selected = { scope: page, type: 'folder', id: folder.id }; });
        group.addEventListener('toggle', () => group.open ? openFolders.add(folder.id) : openFolders.delete(folder.id));
        dragSource(header, 'folder', folder.id);
        dropTarget(header, folder.id);
        group.append(header);
        branch(folder.id, group, level + 1);
        node.append(group);
      }
      for (const [id, item] of grouped.get(parent) || []) {
        const row = el('div', '', 'asar-tree-item');
        row.dataset.itemId = id;
        const open = button(item.title, () => { selected = { scope: page, type: 'item', id }; }, row);
        open.title = 'انتخاب برای انتقال';
        open.addEventListener('dblclick', () => source.open?.(id));
        const launch = button('بازکردن', () => source.open?.(id), row);
        launch.title = item.title;
        dragSource(row, 'item', id);
        node.append(row);
      }
    }
    rows.replaceChildren();
    branch(null, rows);
    target.value = folderIds.has(oldTarget) ? oldTarget : '';
    if (!items.size && !tree.folders.length) rows.append(el('p', 'هنوز اثری در این بخش ثبت نشده است.'));
  }

  function refresh() {
    tree = currentTree();
    let nativeChanged = false;
    if (legacy) {
      const prior = JSON.stringify(tree);
      const collections = legacy.list();
      AsarCollections.seed(tree, collections, legacy.field);
      if (!tree.nativeSynced) {
        for (const [key, destination] of Object.entries(tree.items)) {
          const folder = tree.folders.find(entry => entry.id === destination);
          if (destination && !folder) continue;
          const id = key.slice('item:'.length);
          const target = collections.find(collection => collection.id === AsarCollections.nativeId(folder));
          if (!target?.[legacy.field]?.some(item => item.path === id)) {
            nativeChanged = AsarCollections.moveMedia(collections, legacy.field, id, folder) || nativeChanged;
          }
        }
        tree.nativeSynced = true;
      }
      if (prior !== JSON.stringify(tree)) save();
    }
    render();
    if (nativeChanged) source.changed?.();
  }

  const folderForNative = (id) => AsarCollections.nativeFolder(tree.folders, id)?.id || null;
  document.addEventListener('dragend', clearHover, true);
  window.asarCollections = {
    refresh,
    startDrag,
    startNativeFolderDrag(event, id) {
      startDrag(event, 'folder', folderForNative(id));
    },
    dragOverNative(event) { dragOver(event, event.currentTarget); },
    dragLeaveNative(event) { if (!event.currentTarget.contains(event.relatedTarget)) clearHover(); },
    dropNative(event, id) { return drop(event, folderForNative(id)); },
    removeNativeFolder(id) {
      const folder = folderForNative(id);
      if (folder) removeFolder(folder);
      return Boolean(folder);
    },
    nativeRows(collections) { return AsarCollections.nativeRows(tree.folders, collections); },
    itemFolder(id) { return tree.items['item:' + id] || null; },
    show(id) {
      panel.open = true;
      let folder = tree.folders.find(item => item.id === id);
      const visited = new Set();
      while (folder && !visited.has(folder.id)) {
        visited.add(folder.id);
        openFolders.add(folder.id);
        folder = tree.folders.find(item => item.id === folder.parentId);
      }
      render();
      [...rows.querySelectorAll('details[data-folder-id]')].find(node => node.dataset.folderId === id)?.scrollIntoView({ block: 'nearest' });
    }
  };
  if (page === 'main-app') mount.after(panel);
  else (mount.querySelector('.sidebar-header,.sidebar-hd,.sb-header') || mount.firstElementChild)?.after(panel);
  window.addEventListener('storage', event => {
    if (event.key === key && snapshot !== JSON.stringify(currentTree())) {
      refresh();
      source.redraw?.();
    }
  });
  refresh();
  panel.open = page !== 'main-app';
  source.redraw?.();
  function openRequestedFolder() {
    try {
      const request = JSON.parse(localStorage.getItem('asar-folder-open'));
      if (request?.scope !== page) return;
      localStorage.removeItem('asar-folder-open');
      window.asarCollections.show(request.id);
    } catch {}
  }
  openRequestedFolder();
  window.addEventListener('storage', event => { if (event.key === 'asar-folder-open' && event.newValue) openRequestedFolder(); });
})();
