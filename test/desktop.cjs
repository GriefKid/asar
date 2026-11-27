const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');

const appPath = process.env.ASAR_SMOKE_APP || path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-desktop-test-'));
const windows = new Map();
const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.setPath('userData', profile);
app.setAppPath(appPath);
BrowserWindow.prototype.show = function () {};

app.on('browser-window-created', (_, window) => {
  window.webContents.on('console-message', (_, level, message) => {
    if (level === 3 && /Uncaught (?:ReferenceError|TypeError|SyntaxError)/.test(message)) errors.push(message);
  });
  window.webContents.on('did-finish-load', () => {
    const [, name, file] = window.webContents.getURL().match(/\/([^/]+)\/([^/]+)$/) || [];
    if (file === 'index.html') windows.set(name, window);
  });
});

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => done({ cancel: true }));
});
require(path.join(appPath, 'main.js'));

async function runIn(name, code) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const window = windows.get(name);
    if (window && !window.isDestroyed()) return window.webContents.executeJavaScript(code, true);
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + name);
}

function testPage(file) {
  const stream = 'BT /F1 18 Tf 100 680 Td (Asar test) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream'
  ];
  let contents = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = contents.length;
    contents += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return offset;
  });
  const xref = contents.length;
  contents += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  contents += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  fs.writeFileSync(file, contents);
}

app.whenReady().then(async () => {
  const main = code => runIn('main-app', code);
  assert.equal(await main('document.title'), 'اثر');
  assert.equal(await main('Boolean(document.querySelector(".asar-cover img")?.naturalWidth)'), true);
  assert.equal(await main(`document.fonts.load('800 24px Vazirmatn', 'آرشیو').then(faces => faces.some(face => face.status === 'loaded'))`), true);
  assert.equal(await main(`(() => {
    document.querySelector('.asar-command').click();
    const opened = document.getElementById('cmdpal').classList.contains('show');
    closeCmdPal();
    return opened;
  })()`), true);
  assert.equal(await main('typeof AsarCalendar'), 'object');
  assert.equal(await main('typeof window.asarCollections?.show'), 'function');
  assert.equal(await main('typeof window.asarProfile?.render'), 'function');
  const planner = await main(`(() => {
    document.querySelector('.asar-cover-actions button:not(.primary)').click();
    if (document.querySelector('[data-section="planner"]').getAttribute('aria-current') !== 'page') throw Error('Planner navigation did not update');
    const today = { locked:document.getElementById('plan-add').disabled, rows:document.querySelectorAll('.planner-hour').length };
    const tomorrow = addJalaliDays(todayJalali(), 1);
    selectCalDay(tomorrow.y, tomorrow.m, tomorrow.d);
    openAddEvent('09:00','plan');
    document.getElementById('event-title').value = 'Desktop fixture';
    saveEvent();
    return { ...today, saved:JSON.parse(localStorage.getItem('asar-events'))[dateKey(tomorrow)][0].title };
  })()`);
  assert.deepEqual(planner, { locked: true, rows: 24, saved: 'Desktop fixture' });

  const nested = await main(`(() => {
    showSection('library');
    library.push({ id:'desktop-fixture', title:'A book', type:'book', stage:'queue' });
    saveLib();
    renderLibrary();
    const parent = document.getElementById('asar-collection-tree');
    parent.open = true;
    const name = parent.querySelector('input');
    const button = [...parent.querySelectorAll('button')].find(node => node.textContent === 'ساخت مجموعه');
    name.value = 'Root';
    button.click();
    const root = parent.querySelector('[data-folder-id]');
    const rootId = root.dataset.folderId;
    parent.querySelector('select').value = rootId;
    name.value = 'Nested';
    button.click();
    const child = [...parent.querySelectorAll('[data-folder-id]')].find(node => node.dataset.folderId !== rootId);
    const item = document.getElementById('mcard-desktop-fixture');
    const transfer = new DataTransfer();
    item.dispatchEvent(new DragEvent('dragstart',{ dataTransfer:transfer, bubbles:true, cancelable:true }));
    const allowed = !child.querySelector('summary').dispatchEvent(new DragEvent('dragover',{ dataTransfer:transfer, bubbles:true, cancelable:true }));
    child.querySelector('summary').dispatchEvent(new DragEvent('drop',{ dataTransfer:transfer, bubbles:true, cancelable:true }));
    item.dispatchEvent(new DragEvent('dragend',{ dataTransfer:transfer, bubbles:true, cancelable:true }));
    const { folders, items } = JSON.parse(localStorage.getItem('asar-collections'))['main-app'];
    return { allowed, parent:folders.find(folder => folder.id === child.dataset.folderId).parentId === rootId,
      placement:items['item:desktop-fixture'] === child.dataset.folderId, stage:library[0].stage };
  })()`);
  assert.deepEqual(nested, { allowed: true, parent: true, placement: true, stage: 'queue' });

  const layout = await main(`(() => {
    showSection('home');
    const menu = document.querySelector('.asar-layout-menu');
    [...menu.querySelectorAll('button')].find(button => button.textContent === 'ویرایش چیدمان').click();
    const cover = [...document.querySelectorAll('.asar-layout-handle.move')].find(button => button.textContent === 'جلد');
    cover.dispatchEvent(new KeyboardEvent('keydown',{ key:'ArrowDown', bubbles:true }));
    return { positioned: document.querySelector('.asar-cover').hasAttribute('data-asar-positioned'), saved: Boolean(localStorage.getItem('asar-layouts')) };
  })()`);
  assert.deepEqual(layout, { positioned: true, saved: true });
  await main('[...document.querySelectorAll(".asar-layout-menu button")].find(button => button.textContent === "بازنشانی چیدمان").click()');
  await main('[...document.querySelectorAll(".asar-layout-menu button")].find(button => button.textContent === "قفل چیدمان").click()');
  if (process.env.ASAR_SMOKE_SCREENSHOT) {
    const snapshot = await windows.get('main-app').webContents.capturePage();
    fs.writeFileSync(process.env.ASAR_SMOKE_SCREENSHOT, snapshot.toPNG());
  }

  for (const [name, method] of [['music-player','openMusicPlayer'], ['video-player','openVideoPlayer'], ['writer','openWriter']]) {
    await main('window.api.' + method + '()');
    assert.equal(await runIn(name, 'typeof window.asarCollections?.refresh'), 'function', name);
  }

  for (const [player, field, selector] of [['music-player', 'songs', '.song'], ['video-player', 'videos', '.movie-row']]) {
    const result = await runIn(player, `(() => {
      const field = ${JSON.stringify(field)};
      const selector = ${JSON.stringify(selector)};
      const id = ${JSON.stringify(player)};
      const media = { path: 'C:/sample.ext', title: 'Asar sample' };
      state.collections = [
        { id: 'source', name: 'Source', [field]: [media], open:true },
        { id: 'destination', name: 'Destination', [field]: [], open:false },
      ];
      saveState();
      renderColls();
      function drag(from, to) {
        const dataTransfer = new DataTransfer();
        from.dispatchEvent(new DragEvent('dragstart', { dataTransfer, bubbles:true, cancelable:true }));
        const allowed = !to.dispatchEvent(new DragEvent('dragover', { dataTransfer, bubbles:true, cancelable:true }));
        const highlight = to.closest('.asar-drop') !== null;
        to.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles:true, cancelable:true }));
        from.dispatchEvent(new DragEvent('dragend', { dataTransfer, bubbles:true, cancelable:true }));
        return allowed && highlight;
      }
      const nativeTarget = document.querySelector('#coll-destination .coll-hd');
      const closed = !nativeTarget.closest('.coll').classList.contains('open');
      const accepted = drag(document.querySelector('#coll-source ' + selector), nativeTarget);
      const afterNative = JSON.parse(localStorage.getItem(id)).collections;
      const movedToNative = !afterNative.find(collection => collection.id === 'source')[field].length &&
        afterNative.find(collection => collection.id === 'destination')[field][0]?.path === media.path;
      const panel = document.getElementById('asar-collection-tree');
      panel.querySelector('input').value = 'Nested';
      panel.querySelector('select').value = 'legacy:destination';
      [...panel.querySelectorAll('button')].find(button => button.textContent === 'ساخت مجموعه').click();
      const nested = [...panel.querySelectorAll('details[data-folder-id]')].find(folder => folder.firstElementChild.textContent === 'Nested');
      const nestedId = nested.dataset.folderId;
      const acceptedNested = drag(document.querySelector('#coll-destination ' + selector), nested.querySelector('summary'));
      const afterNested = JSON.parse(localStorage.getItem(id)).collections;
      const folder = document.getElementById('coll-' + nestedId);
      const tree = JSON.parse(localStorage.getItem('asar-collections'))[id];
      return { closed, accepted, movedToNative, acceptedNested,
        movedToNested: !afterNested.find(collection => collection.id === 'destination')[field].length &&
          afterNested.find(collection => collection.id === nestedId)[field][0]?.path === media.path
          && folder.querySelector(selector)?.textContent.includes(media.title),
        indented: folder.style.marginInlineStart === '10px',
        placement: tree.items['item:' + media.path] === nestedId,
        nestedOnce: tree.folders.filter(folder => folder.title === 'Nested').length === 1 };
    })()`);
    assert.deepEqual(result, { closed:true, accepted:true, movedToNative:true, acceptedNested:true, movedToNested:true, indented:true, placement:true, nestedOnce:true }, player);
  }

  let sceneRequest;
  ipcMain.removeHandler('claude:chat');
  ipcMain.handle('claude:chat', (_, _system, messages, _key, _provider, frame) => {
    sceneRequest = { text: messages.at(-1).content, frame };
    return 'test answer';
  });
  const scene = await runIn('video-player', `(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 56;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'orange';
    ctx.fillRect(0, 0, 96, 56);
    const stream = canvas.captureStream(25);
    vid.srcObject = stream;
    vid.muted = true;
    await vid.play();
    vid.pause();
    attachSceneFrame();
    const preview = !document.getElementById('scene-preview').hidden;
    localStorage.setItem('claude-api-key','test-only');
    document.getElementById('ai-textarea').value = 'Describe this frame';
    await sendAI();
    localStorage.removeItem('claude-api-key');
    stream.getTracks().forEach(track => track.stop());
    return { preview, cleared: document.getElementById('scene-preview').hidden };
  })()`);
  assert.deepEqual(scene, { preview: true, cleared: true });
  assert.match(sceneRequest.text, /Describe this frame/);
  assert.match(sceneRequest.frame, /^\/9j\//);
  await main('window.api.openBookReader()');
  const file = path.join(profile, "Asar's offline file.pdf");
  testPage(file);
  await main('window.api.openBookReaderWithFile(' + JSON.stringify(file) + ')');
  let pdf;
  for (let attempt = 0; attempt < 70; attempt++) {
    pdf = await runIn('book-reader', `({
      canvas: !!document.querySelector('#pdf-container canvas'),
      click: typeof document.querySelector('#library-list .book-item')?.onclick,
      folders: typeof window.asarCollections?.show
    })`);
    if (pdf.canvas) break;
    await delay(100);
  }
  assert.deepEqual(pdf, { canvas: true, click: 'function', folders: 'function' });
  const filedBook = await runIn('book-reader', `(() => {
    const original = document.querySelector('#library-list .book-item');
    const panel = document.getElementById('asar-collection-tree');
    panel.querySelector('input').value = 'خواندنی‌ها';
    [...panel.querySelectorAll('button')].find(button => button.textContent === 'ساخت مجموعه').click();
    const source = document.querySelector('#library-list .book-item');
    const folder = panel.querySelector('details[data-folder-id]');
    const folderId = folder.dataset.folderId;
    const target = folder.querySelector('summary');
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { dataTransfer, bubbles:true, cancelable:true }));
    const accepted = !target.dispatchEvent(new DragEvent('dragover', { dataTransfer, bubbles:true, cancelable:true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles:true, cancelable:true }));
    source.dispatchEvent(new DragEvent('dragend', { dataTransfer, bubbles:true, cancelable:true }));
    const tree = JSON.parse(localStorage.getItem('asar-collections'))['book-reader'];
    const savedFolder = [...panel.querySelectorAll('details[data-folder-id]')].find(node => node.dataset.folderId === folderId);
    return { accepted, moved: tree.items['item:' + currentBookPath] === folderId,
      visibleInFolder: Boolean(savedFolder.querySelector('.asar-tree-item')),
      rootCardLeft: Boolean(document.querySelector('#library-list .book-item')),
      readerStillOpen: Boolean(original && document.querySelector('#pdf-container canvas')) };
  })()`);
  assert.deepEqual(filedBook, { accepted:true, moved:true, visibleInFolder:true, rootCardLeft:false, readerStillOpen:true });
  assert.deepEqual(errors, []);
  console.log('Desktop smoke test passed');
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
const timeout = setTimeout(() => app.exit(2), 60_000);
timeout.unref();
