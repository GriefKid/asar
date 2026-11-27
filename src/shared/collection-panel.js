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
    if (!change()) return;
    save();
    render();
  }

  function move(item, destination) {
    if (!item || item.scope !== page) return;
    update(() => {
      if (destination && !tree.folders.some(folder => folder.id === destination)) return false;
      if (item.type === 'folder') {
        if (!AsarCollections.moveFolder(tree.folders, item.id, destination)) {
          status.textContent = 'امکان قراردادن مجموعه درون خودش یا زیرمجموعه‌اش وجود ندارد.';
          return false;
        }
      } else if (item.type === 'item' && source.items().some(record => String(record.id) === item.id)) {
        tree.items['item:' + item.id] = destination || null;
      } else return false;
      if (destination) openFolders.add(destination);
      status.textContent = 'جابه‌جا شد.';
      return true;
    });
  }

  function dragSource(node, type, id) {
    node.draggable = true;
    node.addEventListener('dragstart', event => {
      event.stopPropagation();
      selected = { scope: page, type, id };
      event.dataTransfer.setData(mediaType, JSON.stringify(selected));
      event.dataTransfer.effectAllowed = 'move';
    });
  }

  function dropTarget(node, parentId) {
    node.addEventListener('dragover', event => {
      if (!event.dataTransfer?.types.includes(mediaType)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      node.classList.add('asar-drop');
    });
    node.addEventListener('dragleave', () => node.classList.remove('asar-drop'));
    node.addEventListener('drop', event => {
      const raw = event.dataTransfer?.getData(mediaType);
      if (!raw) return;
      event.preventDefault();
      event.stopPropagation();
      node.classList.remove('asar-drop');
      try { move(JSON.parse(raw), parentId); } catch { status.textContent = 'جابجایی انجام نشد.'; }
    });
  }

  function addFolder() {
    const title = name.value.trim();
    if (!title) { name.focus(); return; }
    update(() => {
      const parentId = target.value || null;
      const folder = { id: globalThis.crypto.randomUUID(), title, parentId };
      tree.folders.push(folder);
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
      name.value = '';
      return true;
    });
  }, actions);
  button('حذف مجموعه', () => {
    if (selected?.type !== 'folder') return;
    if (!confirm('مجموعه حذف شود؟ آثار و زیرمجموعه‌ها به سطح بالاتر منتقل می‌شوند.')) return;
    update(() => AsarCollections.removeFolder(tree, selected.id));
    selected = null;
  }, actions);
  dropTarget(summary, null);

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
        const open = button(item.title, () => { selected = { scope: page, type: 'item', id }; }, row);
        open.title = 'انتخاب برای انتقال';
        open.addEventListener('dblclick', () => source.open?.(id));
        const launch = button('بازکردن', () => source.open?.(id), row);
        launch.title = item.title;
        dragSource(open, 'item', id);
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
    if (source.legacy) {
      const prior = JSON.stringify(tree);
      AsarCollections.seed(tree, source.legacy.list(), source.legacy.field);
      if (prior !== JSON.stringify(tree)) save();
    }
    render();
  }

  window.asarCollections = {
    refresh,
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
    if (event.key === key && snapshot !== JSON.stringify(currentTree())) refresh();
  });
  refresh();
})();
