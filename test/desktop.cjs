const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen, session } = require('electron');

const appPath = process.env.ASAR_SMOKE_APP || path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-desktop-test-'));
const windows = new Map();
const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.setPath('userData', profile);
app.setAppPath(appPath);
const showWindow = BrowserWindow.prototype.show;
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

async function waitIn(name, code) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await runIn(name, code);
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out in ${name}: ${code}`);
}

async function waitForWindowState(condition, description) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function clickIn(name, selector) {
  const point = await runIn(name, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    target.scrollIntoView({ block: 'nearest' });
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (!target.contains(document.elementFromPoint(x, y))) throw new Error('Click target is covered');
    return { x, y };
  })()`);
  const debuggerClient = windows.get(name).webContents.debugger;
  debuggerClient.attach();
  try {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await debuggerClient.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    }
  } finally {
    debuggerClient.detach();
  }
}

async function dragWindowFromContent(window) {
  const bounds = window.getBounds();
  const originalCursor = screen.getCursorScreenPoint;
  const cursor = { x: bounds.x + 20, y: bounds.y + 120 };
  screen.getCursorScreenPoint = () => ({ ...cursor });
  await window.webContents.executeJavaScript(`(() => {
    const surface = document.createElement('div');
    surface.id = 'window-drag-fixture';
    surface.style.cssText = 'position:fixed;left:0;top:100px;width:110px;height:90px;z-index:9999';
    document.body.append(surface);
  })()`);
  const client = window.webContents.debugger;
  client.attach();
  try {
    await client.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 120, button: 'left', buttons: 1, clickCount: 1 });
    await delay(100);
    cursor.x += 45;
    cursor.y += 35;
    await client.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 65, y: 155, button: 'left', buttons: 1 });
    await waitForWindowState(() => window.getBounds().x === bounds.x + 45 && window.getBounds().y === bounds.y + 35, 'window to move from content');
    await client.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: 120, button: 'left', buttons: 0, clickCount: 1 });
  } finally {
    client.detach();
    screen.getCursorScreenPoint = originalCursor;
    await window.webContents.executeJavaScript('document.getElementById("window-drag-fixture").remove()');
  }
}

function testPage(file, label) {
  const stream = `BT /F1 18 Tf 100 680 Td (${label}) Tj ET`;
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

function testWave(file) {
  const sampleRate = 8000;
  const pcmLength = sampleRate * 2 * 6;
  const wav = Buffer.alloc(44 + pcmLength);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcmLength, 40);
  fs.writeFileSync(file, wav);
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
  const mainWindow = windows.get('main-app');
  const mainSize = mainWindow.getSize();
  mainWindow.setSize(930, 640);
  await waitIn('main-app', 'innerWidth <= 930 && document.querySelector(".planner-day").clientWidth >= 400');
  assert.equal(await main(`(() => {
    const libraryTitle = 'اثر <نسخه ۲> & بازبینی';
    renderCommunityGrid([{ title: libraryTitle, artist:'عنوان <تکمیلی>', type:'book', avg:9, count:4 }]);
    return document.querySelector('.community-title').textContent === libraryTitle
      && !document.querySelector('.community-title').children.length
      && document.querySelector('.community-stars').textContent.includes('★★★★★');
  })()`), true);
  mainWindow.setSize(...mainSize);

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
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const clip = new Promise((resolve, reject) => {
      recorder.ondataavailable = async event => resolve(Array.from(new Uint8Array(await event.data.arrayBuffer())));
      recorder.onerror = reject;
    });
    recorder.start();
    const paint = setInterval(() => ctx.fillRect(0, 0, 96, 56), 40);
    await new Promise(resolve => setTimeout(resolve, 600));
    clearInterval(paint);
    recorder.stop();
    const bytes = await clip;
    stream.getTracks().forEach(track => track.stop());
    vid.srcObject = null;
    return { preview, cleared: document.getElementById('scene-preview').hidden, bytes };
  })()`);
  assert.equal(scene.preview, true);
  assert.equal(scene.cleared, true);
  assert.match(sceneRequest.text, /Describe this frame/);
  assert.match(sceneRequest.frame, /^\/9j\//);
  const film = path.join(profile, 'فیلم آزمایشی #1 100%.webm');
  fs.writeFileSync(film, Buffer.from(scene.bytes));

  const subtitleLines = ['Where is the library?', 'What did you see?'];
  const srt = '1\n00:00:00,000 --> 00:00:04,000\nAn alternative English preview.';
  const vtt = `WEBVTT\n\nfirst-cue\n00:00.000 --> 00:01.000\n${subtitleLines[0]}\n\nsecond-cue\n00:01.100 --> 00:04.000\n${subtitleLines[1]}`;
  const release = 'Desktop.Fixture.1080p.BluRay.x264.English.Full.Release.Name';
  ipcMain.removeHandler('subtitle:search');
  const searchKeys = [];
  ipcMain.handle('subtitle:search', (_, _title, _year, key) => {
    searchKeys.push(key);
    return [
      { fileId: 'fixture-srt', name: release },
      { fileId: 'fixture-vtt', name: 'VTT candidate' },
      ...Array.from({ length: 10 }, (_, index) => ({ fileId: `fixture-extra-${index}`, name: `Candidate ${index + 3}` }))
    ];
  });
  ipcMain.removeHandler('subtitle:download');
  const tracks = new Map([
    ['fixture-srt', srt], ['fixture-vtt', vtt]
  ]);
  ipcMain.handle('subtitle:download', (_, id) => tracks.get(id) || null);
  const subtitleCalls = [];
  const liveSubtitles = process.env.ASAR_LIVE_SUBTITLES === '1';
  if (!liveSubtitles) {
    ipcMain.removeHandler('subtitle:translate');
    ipcMain.handle('subtitle:translate', (_, cues) => {
      subtitleCalls.push(cues);
      return subtitleCalls.length === 1 ? ['کتابخانه کجاست؟', null] : ['چه دیدی؟'];
    });
  }
  await runIn('video-player', `(() => {
    localStorage.removeItem('osub-key');
    document.querySelector('.stab[data-mode="fa"]').click();
    vid.addEventListener('loadeddata', () => { vid.pause(); vid.currentTime = 0; }, { once: true });
    loadVideo(${JSON.stringify({ path: film, fileName: path.basename(film), title: 'Desktop fixture film' })});
  })()`);
  await waitIn('video-player', 'vid.readyState >= 2 && vid.paused && !!document.getElementById("spitem-11")');
  assert.equal(await runIn('video-player', 'new URL(vid.currentSrc).hash'), '');
  assert.deepEqual(searchKeys, ['']);
  assert.equal(await runIn('video-player', 'document.querySelector("#spitem-0 .sub-pick-name").textContent'), release);
  await clickIn('video-player', '#spitem-0');
  await waitIn('video-player', 'document.getElementById("spitem-0").classList.contains("selected")');
  assert.equal(await runIn('video-player', 'document.getElementById("sub-en-line").textContent'), 'An alternative English preview.');
  assert.notEqual(await runIn('video-player', 'getComputedStyle(document.getElementById("sub-en-line")).display'), 'none');
  await clickIn('video-player', '#spitem-11');
  await waitIn('video-player', 'document.getElementById("sub-auto-status").classList.contains("error")');
  assert.equal(await runIn('video-player', 'document.getElementById("spitem-0").classList.contains("selected")'), true);
  await clickIn('video-player', '#spitem-1');
  await waitIn('video-player', 'document.getElementById("spitem-1").classList.contains("selected")');
  assert.equal(await runIn('video-player', 'document.getElementById("sub-en-line").textContent'), subtitleLines[0]);
  await clickIn('video-player', '#sub-offset-bar button[onclick="shiftSubs(0.5)"]');
  assert.equal(await runIn('video-player', 'document.getElementById("sub-display").classList.contains("hidden")'), true);
  await clickIn('video-player', '#sub-picker-close');
  assert.equal(await runIn('video-player', 'document.getElementById("sub-picker").hidden'), true);
  await clickIn('video-player', '#sub-picker-toggle');
  assert.equal(await runIn('video-player', 'document.getElementById("sub-offset-val").textContent'), '+0.5s');
  await clickIn('video-player', '#sub-search-btn');
  await waitIn('video-player', 'document.getElementById("sub-auto-status").classList.contains("done")');
  assert.equal(searchKeys.length, 2);
  assert.equal(await runIn('video-player', 'document.getElementById("spitem-1").classList.contains("selected") && subOffset === 0.5'), true);
  await clickIn('video-player', '#sub-offset-val');
  await clickIn('video-player', '#sub-offset-bar button[onclick="shiftSubs(-0.5)"]');
  assert.equal(await runIn('video-player', 'document.getElementById("sub-display").classList.contains("hidden")'), false);
  assert.deepEqual(subtitleCalls, []);
  await clickIn('video-player', '#sub-translate-btn');
  if (!liveSubtitles) {
    await waitIn('video-player', 'document.getElementById("sub-auto-status").classList.contains("error")');
    assert.deepEqual(await runIn('video-player', 'subtitles.map(cue => cue.fa)'), ['کتابخانه کجاست؟', '']);
    await runIn('video-player', 'document.getElementById("sub-translate-btn").click()');
  }
  await waitIn('video-player', 'document.getElementById("sub-translate-btn").textContent === "✓ ترجمه شد"');
  if (!liveSubtitles) assert.deepEqual(subtitleCalls, [subtitleLines, [subtitleLines[1]]]);
  const translated = await runIn('video-player', `({
    times: subtitles.map(cue => [cue.start, cue.end]),
    offset: subOffset,
    persian: subtitles.map(cue => cue.fa),
    mode: subMode,
    displayed: document.getElementById('sub-fa-line').textContent
  })`);
  assert.deepEqual(translated.times, [[0, 1], [1.1, 4]]);
  assert.equal(translated.offset, -0.5);
  assert.equal(translated.mode, 'both');
  for (const cue of translated.persian) assert.match(cue, /[آ-ی]/);
  assert.equal(translated.displayed, translated.persian[0]);

  const videoWindow = windows.get('video-player');
  const videoSize = videoWindow.getSize();
  videoWindow.setSize(930, 640);
  await waitIn('video-player', `innerWidth <= 930 && (() => {
    const controls = document.getElementById('controls');
    return controls.scrollWidth <= controls.clientWidth && document.getElementById('sub-display').getBoundingClientRect().bottom <= controls.getBoundingClientRect().top;
  })()`);
  videoWindow.setSize(...videoSize);

  const firstSong = path.join(profile, 'آهنگ اول #1 100%.wav');
  const secondSong = path.join(profile, 'آهنگ دوم.wav');
  testWave(firstSong);
  fs.copyFileSync(firstSong, secondSong);
  ipcMain.removeHandler('cover:fetch');
  ipcMain.handle('cover:fetch', () => null);
  ipcMain.removeHandler('lyrics:fetch');
  let finishFirstLyrics;
  ipcMain.handle('lyrics:fetch', (_, _artist, title) => title.includes('اول')
    ? new Promise(resolve => { finishFirstLyrics = resolve; }) : 'Lyrics for the second fixture.');
  await main(`library.push({ id:'audit-audio', type:'music', title:'آهنگ اول', stage:'queue', filePath:${JSON.stringify(firstSong)} });
    saveLib(); openInSubApp('audit-audio')`);
  await waitIn('music-player', 'audio.readyState >= 2 && audio.duration === 6');
  assert.equal(await runIn('music-player', 'new URL(audio.currentSrc).hash'), '');
  assert.equal(typeof finishFirstLyrics, 'function');
  await runIn('music-player', `audio.volume = .37; addSongsToColl([${JSON.stringify(secondSong)}])`);
  const secondSongId = await waitIn('main-app', `library.find(item => item.filePath === ${JSON.stringify(secondSong)})?.id`);
  await main(`openInSubApp(${JSON.stringify(secondSongId)})`);
  await waitIn('music-player', 'document.querySelector(".lyr-en")?.textContent === "Lyrics for the second fixture."');
  finishFirstLyrics('Late lyrics for the first fixture.');
  assert.equal(await runIn('music-player', 'audio.volume'), .37);
  assert.equal(await runIn('music-player', 'document.querySelector(".lyr-en").textContent'), 'Lyrics for the second fixture.');
  await runIn('music-player', 'audio.pause()');

  await main('window.api.openBookReader()');
  const file = path.join(profile, "Asar's offline & کتاب.pdf");
  const otherFile = path.join(profile, 'Another offline book.pdf');
  testPage(file, 'First offline document');
  testPage(otherFile, 'Second offline document');
  ipcMain.removeHandler('dialog:openPdfFiles');
  ipcMain.handle('dialog:openPdfFiles', () => [file, otherFile]);
  ipcMain.removeHandler('book:fetchMeta');
  ipcMain.handle('book:fetchMeta', () => null);
  await waitIn('book-reader', 'typeof window.asarCollections?.show === "function"');
  await runIn('book-reader', 'importPdf()');
  assert.equal(await runIn('book-reader', 'currentBookPath'), null);
  await clickIn('book-reader', '#library-list .book-title');
  const readBook = label => waitIn('book-reader',
    `document.querySelector('#pdf-container .textLayer')?.textContent.includes(${JSON.stringify(label)})`);
  await readBook('First offline document');
  const filedBook = await runIn('book-reader', `(() => {
    const original = document.querySelector('#library-list .book-item');
    const panel = document.getElementById('asar-collection-tree');
    panel.open = true;
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
      rootCards: document.querySelectorAll('#library-list .book-item').length,
      readerStillOpen: Boolean(original && document.querySelector('#pdf-container canvas')) };
  })()`);
  assert.deepEqual(filedBook, { accepted:true, moved:true, visibleInFolder:true, rootCards:1, readerStillOpen:true });
  await clickIn('book-reader', '#library-list .book-title');
  await readBook('Second offline document');
  await runIn('book-reader', 'document.getElementById("asar-collection-tree").open = true');
  await clickIn('book-reader', '#asar-collection-tree .asar-tree-item button');
  await readBook('First offline document');
  ipcMain.removeHandler('translate:toFarsi');
  let bookTranslationCalls = 0;
  ipcMain.handle('translate:toFarsi', () => ++bookTranslationCalls === 1 ? null : 'ترجمهٔ آزمایشی کتاب');
  await runIn('book-reader', 'translateAllPages()');
  assert.equal(await runIn('book-reader', 'getTransCache(currentBookPath, 1)'), null);
  assert.equal(await runIn('book-reader', 'document.getElementById("trans-all-btn").disabled'), false);
  await runIn('book-reader', 'translateAllPages()');
  assert.equal(await runIn('book-reader', 'getTransCache(currentBookPath, 1)'), 'ترجمهٔ آزمایشی کتاب');
  assert.equal(await runIn('book-reader', 'document.getElementById("trans-all-btn").disabled'), true);
  const readerBounds = windows.get('book-reader').getBounds();
  await main('window.api.openBookReaderWithFile(' + JSON.stringify(otherFile) + ')');
  await readBook('Second offline document');
  assert.deepEqual(windows.get('book-reader').getBounds(), readerBounds);
  const readerWindow = windows.get('book-reader');
  const originalCanvasWidth = await runIn('book-reader', 'document.querySelector("#pdf-container canvas").width');
  const narrowerWidth = Math.min(930, readerBounds.width - 120);
  readerWindow.setSize(narrowerWidth, 620);
  await waitIn('book-reader', `innerWidth <= ${narrowerWidth} && (() => {
    const toolbar = document.querySelector('.reader-toolbar');
    const canvas = document.querySelector('#pdf-container canvas');
    return toolbar.scrollWidth <= toolbar.clientWidth && canvas && canvas.width < ${originalCanvasWidth};
  })()`);
  readerWindow.setBounds(readerBounds);

  for (const [name, reopen] of [
    ['music-player', 'openMusicPlayer'], ['video-player', 'openVideoPlayer'],
    ['book-reader', 'openBookReader'], ['writer', 'openWriter'], ['main-app', null]
  ]) {
    const window = windows.get(name);
    showWindow.call(window);
    assert.equal(window.isNormal(), true, name);
    const normal = window.getBounds();
    await runIn(name, 'document.body.dataset.windowState = "preserved"');

    await clickIn(name, '[data-window-action="minimize"]');
    await waitForWindowState(() => !window.isDestroyed() && window.isMinimized(), `${name} to minimize`);
    assert.equal(window.isDestroyed(), false, name);
    if (reopen) await main(`window.api.${reopen}()`);
    else window.restore();
    await waitForWindowState(() => !window.isDestroyed() && window.isNormal(), `${name} to restore`);
    assert.equal(windows.get(name), window, name);

    const fullscreenSelector = '[data-window-action="fullscreen"]';
    await clickIn(name, fullscreenSelector);
    await waitForWindowState(() => window.isFullScreen(), `${name} to enter fullscreen`);
    await waitIn(name, `document.querySelector('${fullscreenSelector}').getAttribute('aria-pressed') === 'true'`);
    await clickIn(name, fullscreenSelector);
    await waitForWindowState(() => window.isNormal(), `${name} to leave fullscreen`);
    await waitIn(name, `document.querySelector('${fullscreenSelector}').getAttribute('aria-pressed') === 'false'`);
    assert.deepEqual(window.getBounds(), normal, name);
    await runIn(name, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))');
    if (name === 'main-app') await dragWindowFromContent(window);
    assert.equal(await runIn(name, 'document.body.dataset.windowState'), 'preserved', name);
    if (name === 'book-reader') await readBook('Second offline document');

    if (reopen) {
      if (name === 'writer') {
        await runIn(name, `(() => {
          newDoc();
          for (const [id, value] of [['doc-title','عنوان فوری'], ['editor-content','متن نوشته پیش از بستن پنجره']]) {
            const input = document.getElementById(id);
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()`);
      }
      await clickIn(name, '[data-window-action="close"]');
      await waitForWindowState(() => window.isDestroyed(), `${name} to close`);
      if (name === 'writer') {
        const saved = await main(`JSON.parse(localStorage.getItem('asar-writer-docs')).at(-1)`);
        assert.equal(saved.title, 'عنوان فوری');
        assert.equal(saved.content, 'متن نوشته پیش از بستن پنجره');
      }
    } else {
      await main('openCmdPal()');
      await clickIn(name, '[data-window-action="close"]');
      assert.equal(await main('document.getElementById("exit-modal").classList.contains("show")'), true);
      await clickIn(name, '#exit-cancel-btn');
      assert.equal(window.isDestroyed(), false, name);
      assert.equal(await main('document.getElementById("cmdpal").classList.contains("show")'), true);
      await main('closeCmdPal()');
    }
  }
  assert.deepEqual(errors, []);
  console.log('Desktop smoke test passed');
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
const timeout = setTimeout(() => app.exit(2), 60_000);
timeout.unref();
