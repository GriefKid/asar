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
    const item = [...parent.querySelectorAll('.asar-tree-item button')].find(node => node.textContent === 'A book');
    const transfer = new DataTransfer();
    item.dispatchEvent(new DragEvent('dragstart',{ dataTransfer:transfer, bubbles:true, cancelable:true }));
    child.querySelector('summary').dispatchEvent(new DragEvent('drop',{ dataTransfer:transfer, bubbles:true, cancelable:true }));
    const { folders, items } = JSON.parse(localStorage.getItem('asar-collections'))['main-app'];
    return { parent:folders.find(folder => folder.id === child.dataset.folderId).parentId === rootId,
      placement:items['item:desktop-fixture'] === child.dataset.folderId, stage:library[0].stage };
  })()`);
  assert.deepEqual(nested, { parent: true, placement: true, stage: 'queue' });

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
  assert.deepEqual(errors, []);
  console.log('Desktop smoke test passed');
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
const timeout = setTimeout(() => app.exit(2), 60_000);
timeout.unref();
