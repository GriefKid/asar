const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { pathToFileURL } = require('node:url');
const { selectProfilePath } = require('./src/shared/profile-path.cjs');
const { createSubtitleTranslator } = require('./src/shared/subtitle-translation.cjs');

const profilePath = selectProfilePath(app.getPath('appData'), app.getPath('userData'));
if (fs.existsSync(profilePath)) app.setPath('userData', profilePath);
if (process.platform === 'win32') app.setAppUserModelId('com.griefkid.mylife');

let mainWindow = null;
let musicWindow = null;
let videoWindow = null;
let bookWindow = null;
let writerWindow = null;

const WEB_PREFS = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: false
};

const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');
const fileReceivers = new WeakSet();
const pendingFiles = new WeakMap();

app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    event.preventDefault();
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' && ['t.me', 'github.com'].includes(target.hostname)) shell.openExternal(target.href);
    } catch {}
  });
});

function createAppWindow(file, width, height, display, backgroundColor = '#04040C') {
  const currentDisplay = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay();
  const area = (display || currentDisplay).workArea;
  width = Math.min(width, Math.floor(area.width * 0.9));
  height = Math.min(height, Math.floor(area.height * 0.9));
  const window = new BrowserWindow({
    width, height, x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2),
    frame: false, backgroundColor, icon: APP_ICON, webPreferences: WEB_PREFS, show: false
  });
  for (const [event, fullscreen] of [['enter-full-screen', true], ['leave-full-screen', false]]) {
    window.on(event, () => window.webContents.send('window:fullscreen-changed', fullscreen));
  }
  window.webContents.on('did-start-loading', () => fileReceivers.delete(window.webContents));
  window.loadFile(file);
  window.once('ready-to-show', () => window.show());
  return window;
}

function createMusicPlayer() {
  musicWindow = createAppWindow('src/apps/music-player/index.html', 1320, 850);
  musicWindow.on('closed', () => { musicWindow = null; });
}

function createVideoPlayer(display) {
  videoWindow = createAppWindow('src/apps/video-player/index.html', 1400, 885, display);
  videoWindow.on('closed', () => { videoWindow = null; });
}

function createMainApp() {
  mainWindow = createAppWindow('src/main-app/index.html', 1420, 920);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createBookReader(display) {
  bookWindow = createAppWindow('src/apps/book-reader/index.html', 1320, 900, display);
  bookWindow.on('closed', () => { bookWindow = null; });
}

function createWriter() {
  writerWindow = createAppWindow('src/apps/writer/index.html', 1100, 740, undefined, '#0f0f13');
  writerWindow.on('closed', () => { writerWindow = null; });
}

// ── IPC: Open sub-apps ─────────────────────────────────────────────────
function focusWindow(window) {
  if (window.isMinimized()) window.restore();
  window.focus();
}

ipcMain.handle('app:open-music', () => {
  if (musicWindow) { focusWindow(musicWindow); return; }
  createMusicPlayer();
});
ipcMain.handle('app:open-video', () => {
  if (videoWindow) { focusWindow(videoWindow); return; }
  createVideoPlayer();
});
ipcMain.handle('app:open-book', () => {
  if (bookWindow) { focusWindow(bookWindow); return; }
  createBookReader();
});
ipcMain.handle('app:open-writer', () => {
  if (writerWindow) { focusWindow(writerWindow); return; }
  createWriter();
});

// ── IPC: Library sync ──────────────────────────────────────────────────
ipcMain.handle('lib:addItem', (_, item) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lib:item-added', item);
  }
});

// ── Download helpers ───────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 15000 }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse fail')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 120000 }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
      file.on('error', e => { fs.unlink(destPath, () => {}); reject(e); });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('download timeout')); });
  });
}

function getDownloadsDir() {
  const dir = path.join(app.getPath('downloads'), 'اثر');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 120);
}

async function tryDownloadBook(item) {
  const q = encodeURIComponent(item.title + (item.creator ? ' ' + item.creator : ''));
  const searchUrl = `https://archive.org/advancedsearch.php?q=${q}&fl=identifier,title&rows=5&output=json&mediatype=texts`;
  const data = await fetchJson(searchUrl);
  const docs = data?.response?.docs || [];
  if (!docs.length) return null;

  for (const doc of docs) {
    try {
      const meta = await fetchJson(`https://archive.org/metadata/${doc.identifier}/files`);
      const files = meta?.result || [];
      const pdf = files.find(f => f.name && f.name.toLowerCase().endsWith('.pdf') && !f.name.includes('_thumb'));
      if (!pdf) continue;
      const url = `https://archive.org/download/${doc.identifier}/${encodeURIComponent(pdf.name)}`;
      const dest = path.join(getDownloadsDir(), sanitizeFilename(pdf.name));
      await downloadFile(url, dest);
      return dest;
    } catch { continue; }
  }
  return null;
}

async function tryDownloadMusic(item) {
  const q = encodeURIComponent(item.title + (item.creator ? ' ' + item.creator : ''));
  const searchUrl = `https://archive.org/advancedsearch.php?q=${q}&fl=identifier,title&rows=5&output=json&mediatype=audio`;
  const data = await fetchJson(searchUrl);
  const docs = data?.response?.docs || [];
  if (!docs.length) return null;

  for (const doc of docs) {
    try {
      const meta = await fetchJson(`https://archive.org/metadata/${doc.identifier}/files`);
      const files = meta?.result || [];
      const audio = files.find(f => f.name && (f.name.toLowerCase().endsWith('.mp3') || f.name.toLowerCase().endsWith('.ogg') || f.name.toLowerCase().endsWith('.flac')));
      if (!audio) continue;
      const url = `https://archive.org/download/${doc.identifier}/${encodeURIComponent(audio.name)}`;
      const dest = path.join(getDownloadsDir(), sanitizeFilename(audio.name));
      await downloadFile(url, dest);
      return dest;
    } catch { continue; }
  }
  return null;
}

ipcMain.handle('lib:download', async (_, item) => {
  try {
    let filePath = null;
    if (item.type === 'book')  filePath = await tryDownloadBook(item);
    if (item.type === 'music') filePath = await tryDownloadMusic(item);
    // films: too large / not freely available, skip auto-download
    return { filePath };
  } catch (e) {
    return { filePath: null };
  }
});

// ── IPC: Open sub-apps with specific file (second monitor) ─────────────
function secondaryDisplay() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().find(display => display.id !== primary.id);
}

function openFileIn(window, filePath) {
  if (typeof filePath !== 'string' || !filePath) return;
  const contents = window.webContents;
  if (fileReceivers.has(contents)) contents.send('open:file', filePath);
  else pendingFiles.set(contents, filePath);
}

ipcMain.on('open:file-ready', ({ sender }) => {
  fileReceivers.add(sender);
  if (!pendingFiles.has(sender)) return;
  const filePath = pendingFiles.get(sender);
  pendingFiles.delete(sender);
  sender.send('open:file', filePath);
});

ipcMain.handle('app:open-book-file', (_, filePath) => {
  if (bookWindow) focusWindow(bookWindow);
  else createBookReader(secondaryDisplay());
  openFileIn(bookWindow, filePath);
});

ipcMain.handle('app:open-video-file', (_, filePath) => {
  if (videoWindow) focusWindow(videoWindow);
  else createVideoPlayer(secondaryDisplay());
  openFileIn(videoWindow, filePath);
});

ipcMain.handle('app:open-music-file', (_, filePath) => {
  if (musicWindow) focusWindow(musicWindow);
  else createMusicPlayer();
  openFileIn(musicWindow, filePath);
});

ipcMain.handle('file:media-url', (_, filePath) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return null;
  return pathToFileURL(filePath).href;
});

app.whenReady().then(() => {
  createMainApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainApp();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Window controls ───────────────────────────────────────────────
ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});
ipcMain.handle('window:toggle-fullscreen', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) window.setFullScreen(!window.isFullScreen());
});
ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});
ipcMain.handle('app:quit', () => {
  app.quit();
});

const windowDrags = new WeakMap();
ipcMain.on('window:drag-start', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isMinimized()) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = window.getBounds();
  const restore = window.isFullScreen() || window.isMaximized();
  const normal = window.getNormalBounds();
  windowDrags.set(window, {
    restore,
    x: restore ? Math.round(Math.max(0, Math.min(1, (cursor.x - bounds.x) / bounds.width)) * normal.width) : cursor.x - bounds.x,
    y: restore ? Math.max(0, Math.min(24, cursor.y - bounds.y)) : cursor.y - bounds.y
  });
});
ipcMain.on('window:drag-move', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const drag = windowDrags.get(window);
  if (!drag || window.isMinimized()) return;
  if (drag.restore) {
    if (window.isFullScreen()) window.setFullScreen(false);
    else if (window.isMaximized()) window.unmaximize();
    drag.restore = false;
  }
  if (window.isFullScreen() || window.isMaximized()) return;
  const cursor = screen.getCursorScreenPoint();
  window.setPosition(cursor.x - drag.x, cursor.y - drag.y);
});
ipcMain.on('window:drag-end', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) windowDrags.delete(window);
});

// ── IPC: File dialogs ──────────────────────────────────────────────
ipcMain.handle('dialog:openAudioFiles', async () => {
  const result = await dialog.showOpenDialog(musicWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3','flac','wav','m4a','aac','ogg','wma','opus','ape','alac'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:openAudioFolder', async () => {
  const result = await dialog.showOpenDialog(musicWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) return [];
  const folder = result.filePaths[0];
  const audioExts = ['.mp3','.flac','.wav','.m4a','.aac','.ogg','.wma','.opus','.ape'];
  const files = [];
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (audioExts.includes(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  }
  scan(folder);
  return files;
});

// ── IPC: Audio metadata (from filename) ───────────────────────────
ipcMain.handle('audio:getMeta', async (_, filePath) => {
  const name = path.basename(filePath, path.extname(filePath));
  const parts = name.split(' - ');
  return {
    path: filePath,
    title: parts.length >= 2 ? parts[1].trim() : name,
    artist: parts.length >= 2 ? parts[0].trim() : 'Unknown',
    fileName: name
  };
});

// ── IPC: Lyrics fetch ──────────────────────────────────────────────
ipcMain.handle('lyrics:fetch', async (_, artist, title) => {
  const tryFetch = async (url, extract) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json();
      return extract(data) || null;
    } catch { return null; }
  };

  // 1. lrclib.net — with artist+title
  if (artist && title) {
    const lrclib = await tryFetch(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`,
      d => d.plainLyrics
    );
    if (lrclib) return lrclib;
  }

  // 2. lrclib search — works with title only too
  if (title) {
    const q = artist ? `${artist} ${title}` : title;
    const search = await tryFetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`,
      d => Array.isArray(d) && d[0]?.plainLyrics ? d[0].plainLyrics : null
    );
    if (search) return search;
  }

  // 3. lyrics.ovh fallback (needs artist)
  if (artist && title) {
    const ovh = await tryFetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
      d => d.lyrics
    );
    if (ovh) return ovh;
  }

  return null;
});

// ── IPC: Translate ─────────────────────────────────────────────────
const translateSubtitleCues = createSubtitleTranslator();
ipcMain.handle('subtitle:translate', (_, cues) => translateSubtitleCues(cues));

ipcMain.handle('translate:toFarsi', async (_, text) => {
  // Try Google Translate (gtx — no key needed)
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fa&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = await res.json();
      const result = data[0].map(s => s[0]).join('');
      if (result && result.trim()) return result;
    }
  } catch {}

  // Fallback: MyMemory (free, no key, works without VPN)
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|fa`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const data = await res.json();
      const t = data.responseData?.translatedText;
      if (t && t.trim() && !t.includes('PLEASE SELECT')) return t;
    }
  } catch {}

  return null;
});

// ── IPC: Song info (MusicBrainz) ───────────────────────────────────
ipcMain.handle('info:fetch', async (_, artist, title) => {
  try {
    const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
    const url = `https://musicbrainz.org/ws/2/recording/?query=${q}&limit=1&fmt=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ArasApp/1.0 (personal)' },
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();
    if (!data.recordings?.length) return null;
    const rec = data.recordings[0];
    return {
      title: rec.title,
      artist: rec['artist-credit']?.[0]?.name || artist,
      duration: rec.length ? Math.round(rec.length / 1000) : null,
      releases: rec.releases?.map(r => ({ title: r.title, date: r.date })) || [],
      id: rec.id
    };
  } catch {
    return null;
  }
});

// ── IPC: Cover fetch (Deezer first — mzstatic CDN is geo-blocked) ─
ipcMain.handle('cover:fetch', async (_, artist, title) => {
  const q = encodeURIComponent(`${artist} ${title}`);

  // 1. Deezer track search
  try {
    const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    if (data.data?.length) return data.data[0].album?.cover_big || data.data[0].album?.cover_medium || null;
  } catch {}

  // 2. Deezer artist search (better for Persian/Iranian artists)
  if (artist) {
    try {
      const qa = encodeURIComponent(artist);
      const res = await fetch(`https://api.deezer.com/search/artist?q=${qa}&limit=1`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      const artistId = data.data?.[0]?.id;
      if (artistId) {
        const r2 = await fetch(`https://api.deezer.com/artist/${artistId}/top?limit=1`, { signal: AbortSignal.timeout(5000) });
        const d2 = await r2.json();
        return d2.data?.[0]?.album?.cover_big || null;
      }
    } catch {}
  }

  return null;
});

// ── IPC: Video file dialog ─────────────────────────────────────────────
ipcMain.handle('dialog:openVideoFiles', async () => {
  const win = videoWindow || BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video Files', extensions: ['mp4','mkv','avi','mov','webm','m4v','wmv','flv','ts','mpg','mpeg'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:openSubtitleFile', async () => {
  const win = videoWindow || BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Subtitle Files', extensions: ['srt','vtt','ass','ssa'] }]
  });
  if (result.canceled) return null;
  return decodeSubtitle(fs.readFileSync(result.filePaths[0]));
});

// ── IPC: TMDB search ───────────────────────────────────────────────────
async function tmdbSearchRaw(title, apiKey) {
  const q = encodeURIComponent(title);
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${q}&language=en-US&page=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.results?.length) return null;
  const m = data.results[0];
  return {
    id: m.id, title: m.title, original_title: m.original_title,
    overview: m.overview, release_date: m.release_date, vote_average: m.vote_average,
    poster_path: m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
    backdrop_path: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : null,
    genre_ids: m.genre_ids
  };
}

ipcMain.handle('tmdb:search', async (_, title, apiKey) => {
  try {
    // Try as-is first
    let result = await tmdbSearchRaw(title, apiKey);
    if (result) return result;
    // Strip year, release group, punctuation and retry
    const stripped = title
      .replace(/\b(19|20)\d{2}\b/g, '')
      .replace(/-[A-Z0-9]+$/i, '')
      .replace(/[:\-]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (stripped && stripped !== title) {
      result = await tmdbSearchRaw(stripped, apiKey);
      if (result) return result;
    }
    // Last try: first 2 words only
    const short = stripped.split(' ').slice(0, 2).join(' ');
    if (short && short !== stripped) return await tmdbSearchRaw(short, apiKey);
    return null;
  } catch { return null; }
});

// ── IPC: Book metadata (Google Books + Open Library fallback) ─────────
ipcMain.handle('book:fetchMeta', async (_, title) => {
  const cleanTitle = title
    .replace(/^\d{1,4}\s*[-–—.]\s*/, '')
    .replace(/[_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Build search variants — more specific first, then broader
  const noSubtitle = cleanTitle.split(/[:،\-–—]/)[0].trim();
  const shortTitle = cleanTitle.split(/\s+/).slice(0, 4).join(' ');
  const variants = [...new Set([cleanTitle, noSubtitle, shortTitle].filter(v => v.length > 2))];

  for (const searchTerm of variants) {
    // ── Try Google Books ──
    try {
      const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(searchTerm)}&maxResults=5`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const item = (data.items || []).find(i => i.volumeInfo?.imageLinks) || data.items?.[0];
        if (item) {
          const vol = item.volumeInfo;
          const thumb = vol.imageLinks?.thumbnail || vol.imageLinks?.smallThumbnail;
          if (thumb) {
            return {
              title: vol.title || cleanTitle,
              authors: vol.authors || [],
              description: vol.description || null,
              cover: thumb.replace('http:', 'https:').replace('zoom=1', 'zoom=5'),
              publishedDate: vol.publishedDate || null,
              categories: vol.categories || [],
            };
          }
          // No thumbnail — try Open Library cover via ISBN
          const isbns = (vol.industryIdentifiers || [])
            .filter(x => x.type.includes('ISBN')).map(x => x.identifier);
          for (const isbn of isbns) {
            try {
              const checkUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
              const r = await fetch(checkUrl, { signal: AbortSignal.timeout(5000) });
              if (r.ok) {
                return {
                  title: vol.title || cleanTitle,
                  authors: vol.authors || [],
                  description: vol.description || null,
                  cover: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
                  publishedDate: vol.publishedDate || null,
                  categories: vol.categories || [],
                };
              }
            } catch {}
          }
        }
      }
    } catch {}

    // ── Try Open Library ──
    try {
      const olUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(searchTerm)}&fields=key,title,author_name,cover_i,first_publish_year&limit=5`;
      const olRes = await fetch(olUrl, { signal: AbortSignal.timeout(8000) });
      if (olRes.ok) {
        const olData = await olRes.json();
        const olItem = (olData.docs || []).find(d => d.cover_i);
        if (olItem) {
          return {
            title: olItem.title || cleanTitle,
            authors: olItem.author_name || [],
            description: null,
            cover: `https://covers.openlibrary.org/b/id/${olItem.cover_i}-L.jpg`,
            publishedDate: olItem.first_publish_year ? String(olItem.first_publish_year) : null,
            categories: [],
          };
        }
      }
    } catch {}
  }

  return null;
});

// ── IPC: Book / PDF ───────────────────────────────────────────────────
ipcMain.handle('dialog:openPdfFiles', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('file:readBuffer', async (_, filePath) => {
  const buf = await fs.promises.readFile(filePath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});

// ── IPC: Subtitle search + download ───────────────────────────────────
const AdmZip = require('adm-zip');
const zlib = require('zlib');

function scoreSubtitleSync(releaseName, fileName) {
  if (!releaseName || !fileName) return 0;
  const rn = releaseName.toLowerCase().replace(/[_\s]/g, '.');
  const fn = fileName.toLowerCase().replace(/[_\s]/g, '.');
  // Exact or near-exact match = highest priority
  if (rn === fn || rn.startsWith(fn) || fn.startsWith(rn)) return 1000;
  const tags = ['1080p','720p','2160p','4k','bluray','blu-ray','webrip','web-dl','webdl','hdtv','hdcam','x264','x265','hevc','h264','h265','avc'];
  let score = 0;
  for (const t of tags) {
    const inRn = rn.includes(t), inFn = fn.includes(t);
    if (inRn && inFn) score += 3;
    else if (inRn !== inFn) score -= 1;
  }
  return score;
}

// OpenSubtitles file hash — guarantees subtitle sync with video
function computeOSHash(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    if (fileSize < 131072) return null;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(65536);
    let hash = BigInt(fileSize);
    fs.readSync(fd, buf, 0, 65536, 0);
    for (let i = 0; i < 65536; i += 8) hash = BigInt.asUintN(64, hash + buf.readBigInt64LE(i));
    fs.readSync(fd, buf, 0, 65536, fileSize - 65536);
    for (let i = 0; i < 65536; i += 8) hash = BigInt.asUintN(64, hash + buf.readBigInt64LE(i));
    fs.closeSync(fd);
    return { hash: hash.toString(16).padStart(16, '0'), size: fileSize };
  } catch { return null; }
}

async function searchByHash(videoPath, fileName) {
  try {
    const h = computeOSHash(videoPath);
    if (!h) return null;
    const url = `https://rest.opensubtitles.org/search/moviebytesize-${h.size}/moviehash-${h.hash}/sublanguageid-eng`;
    const res = await fetch(url, {
      headers: { 'X-User-Agent': 'TemporaryUserAgent', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    return data.filter(s => s.SubFormat === 'srt' || s.SubFormat === 'ass').slice(0, 3).map((s, i) => ({
      fileId: s.SubDownloadLink,
      name: s.MovieReleaseName || s.SubFileName || `Hash match ${i + 1}`,
      score: 100,
    }));
  } catch { return null; }
}

async function searchSubdl(title, year, apiKey, fileName) {
  try {
    // Include year in film_name — subdl ignores the year param but searches it in the title
    const query = year ? `${title} ${year}` : title;
    const url = `https://api.subdl.com/api/v1/subtitles?api_key=${apiKey}&film_name=${encodeURIComponent(query)}&languages=EN`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.status || !data.subtitles?.length) return null;
    // Filter: release_name must contain year (or no year known)
    const yearStr = year ? String(year) : null;
    const relevant = data.subtitles.filter(s => {
      if (!yearStr) return true;
      const rn = (s.release_name || '').toLowerCase();
      return rn.includes(yearStr);
    });
    const source = relevant.length ? relevant : data.subtitles; // fallback to all if filter removes everything
    const list = source.slice(0, 15).map((s, i) => ({
      fileId: s.url,
      name: s.release_name || `Subtitle ${i + 1}`,
      score: fileName ? scoreSubtitleSync(s.release_name || '', fileName) : 0,
      source: 'subdl',
    }));
    list.sort((a, b) => b.score - a.score);
    return list.slice(0, 5);
  } catch { return null; }
}

// OpenSubtitles.com v3 REST API (requires free API key from opensubtitles.com)
async function searchOpenSubsV3(title, year, imdbId, apiKey, fileName) {
  try {
    let url = `https://api.opensubtitles.com/api/v1/subtitles?languages=en&type=movie`;
    if (imdbId) url += `&imdb_id=${String(imdbId).replace(/^tt/i, '')}`;
    else {
      url += `&query=${encodeURIComponent(title)}`;
      if (year) url += `&year=${year}`;
    }
    const res = await fetch(url, {
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'ArasApp v1.0',
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.data?.length) return null;
    const list = data.data.flatMap(item => {
      const rel = item.attributes?.release || item.attributes?.feature_details?.movie_name || '';
      return (item.attributes?.files || []).map(f => ({
        fileId: `osv3:${f.file_id}:${apiKey}`,
        name: rel || `OpenSubtitles ${item.id}`,
        score: fileName ? scoreSubtitleSync(rel, fileName) : 0,
        source: 'osv3',
      }));
    });
    list.sort((a, b) => b.score - a.score);
    return list.slice(0, 8);
  } catch { return null; }
}

// OpenSubtitles.org v1 by title — no API key needed, free public search
async function searchOSv1ByTitle(title, year, fileName) {
  try {
    const q = encodeURIComponent(title.replace(/\s+/g, '+'));
    const url = `https://rest.opensubtitles.org/search/query-${q}/sublanguageid-eng`;
    const res = await fetch(url, {
      headers: { 'X-User-Agent': 'TemporaryUserAgent', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    const yearStr = year ? String(year) : null;
    // Filter by year if known
    const byYear = yearStr ? data.filter(s => String(s.MovieYear || '') === yearStr) : data;
    const pool = byYear.length ? byYear : data;
    const relevant = pool.filter(s => s.SubFormat === 'srt' || s.SubFormat === 'ass' || !s.SubFormat);
    if (!relevant.length) return null;
    relevant.sort((a, b) => (parseInt(b.SubDownloadsCnt) || 0) - (parseInt(a.SubDownloadsCnt) || 0));
    return relevant.slice(0, 6).map((s, i) => ({
      fileId: s.SubDownloadLink,
      name: s.MovieReleaseName || s.SubFileName || `OS ${i + 1}`,
      score: fileName ? scoreSubtitleSync(s.MovieReleaseName || '', fileName) : 0,
      source: 'osv1_title',
    }));
  } catch { return null; }
}

// OS v1 hash-only text search — strictly filtered (v1 text search is unreliable but hash still works)
async function searchOSv1ByImdb(imdbId, title, year, fileName) {
  try {
    const id = String(imdbId).replace(/^tt/i, '');
    const res = await fetch(`https://rest.opensubtitles.org/search/imdbid-${id}/sublanguageid-eng`, {
      headers: { 'X-User-Agent': 'TemporaryUserAgent', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    const relevant = data.filter(s => s.SubFormat === 'srt' || s.SubFormat === 'ass');
    if (!relevant.length) return null;
    const list = relevant.slice(0, 15).map((s, i) => {
      const syncScore = fileName ? scoreSubtitleSync(s.MovieReleaseName || s.SubFileName || '', fileName) : 0;
      const dlCount = parseInt(s.SubDownloadsCnt) || 0;
      return {
        fileId: s.SubDownloadLink,
        name: s.MovieReleaseName || s.SubFileName || `Subtitle ${i + 1}`,
        score: syncScore,
        sortKey: syncScore >= 1000 ? 1000000 + dlCount : syncScore * 10000 + Math.min(dlCount, 9999),
        source: 'osv1',
      };
    });
    list.sort((a, b) => b.sortKey - a.sortKey);
    return list.slice(0, 5);
  } catch { return null; }
}

ipcMain.handle('subtitle:search', async (_, title, year, apiKey, fileName, videoPath, imdbId) => {
  // Run hash search AND text searches in parallel, combine (hash first for sync priority)
  const parallelSearches = [];

  if (videoPath) parallelSearches.push(searchByHash(videoPath, fileName));
  else parallelSearches.push(Promise.resolve(null));

  if (apiKey) {
    parallelSearches.push(searchSubdl(title, year, apiKey, fileName));
    parallelSearches.push(searchOpenSubsV3(title, year, imdbId, apiKey, fileName));
  } else {
    parallelSearches.push(Promise.resolve(null));
    parallelSearches.push(Promise.resolve(null));
  }

  // OS v1 by title (no key needed) + by IMDB
  parallelSearches.push(searchOSv1ByTitle(title, year, fileName));
  if (imdbId) parallelSearches.push(searchOSv1ByImdb(imdbId, title, year, fileName));

  const [hashR, subdlR, osv3R, osv1TitleR, ...rest] = await Promise.all(parallelSearches);
  const imdbR = rest[0] || null;

  // Combine: subdl first (most entries), then osv1_title, then hash (synced but sparse), then others
  const combined = [
    ...(subdlR || []),
    ...(osv1TitleR || []),
    ...(hashR || []),
    ...(osv3R || []),
    ...(imdbR || []),
  ];

  console.log(`[sub] hash:${hashR?.length??0} subdl:${subdlR?.length??0} osv3:${osv3R?.length??0} osv1_title:${osv1TitleR?.length??0} imdb:${imdbR?.length??0} → ${combined.length} total`);
  return combined.length ? combined : null;
});

// ── IPC: Subtitle download (ZIP / gzip / plain) ────────────────────────
function decodeSubtitle(buffer) {
  if (buffer.length < 2) return buffer.toString('utf8');
  const marker = buffer.readUInt16BE(0);
  if (marker === 0xfffe || marker === 0xfeff) {
    return new TextDecoder(marker === 0xfffe ? 'utf-16le' : 'utf-16be').decode(buffer);
  }
  const utf8 = buffer.toString('utf8');
  return utf8.includes('\ufffd') ? new TextDecoder('windows-1252').decode(buffer) : utf8;
}

ipcMain.handle('subtitle:download', async (_, fileUrl, apiKey) => {
  try {
    let fullUrl, extraHeaders = {};

    // OpenSubtitles.com v3: needs 2-step download (get token then download)
    if (fileUrl.startsWith('osv3:')) {
      const [, fileId, key] = fileUrl.split(':');
      const tokenRes = await fetch('https://api.opensubtitles.com/api/v1/download', {
        method: 'POST',
        headers: { 'Api-Key': key, 'Content-Type': 'application/json', 'User-Agent': 'ArasApp v1.0' },
        body: JSON.stringify({ file_id: parseInt(fileId) }),
        signal: AbortSignal.timeout(10000),
      });
      if (!tokenRes.ok) return null;
      const tokenData = await tokenRes.json();
      if (!tokenData.link) return null;
      fullUrl = tokenData.link;
    } else if (fileUrl.startsWith('http')) {
      fullUrl = fileUrl;
      if (fileUrl.includes('opensubtitles')) extraHeaders = { 'X-User-Agent': 'TemporaryUserAgent', 'User-Agent': 'Mozilla/5.0' };
    } else {
      fullUrl = `https://dl.subdl.com${fileUrl}`;
    }
    const res = await fetch(fullUrl, { headers: extraHeaders, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Detect format by magic bytes
    const magic = buf.slice(0, 2).toString('hex');
    if (magic === '1f8b') {
      return decodeSubtitle(zlib.gunzipSync(buf));
    } else if (magic === '504b') {
      const zip = new AdmZip(buf);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !/\.(srt|ass|ssa|vtt)$/i.test(entry.name) || entry.name.startsWith('._')) continue;
        const subtitle = decodeSubtitle(entry.getData());
        if (/\d\s*-->\s*\d|^Dialogue:/m.test(subtitle)) return subtitle;
      }
      return null;
    } else {
      return decodeSubtitle(buf);
    }
  } catch { return null; }
});

// ── IPC: Image proxy (bypass geo-blocked CDNs in renderer) ────────────
ipcMain.handle('image:fetch', async (_, url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || 'image/jpeg';
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch { return null; }
});

// ── IPC: AI chat (Claude / Groq / DeepSeek) ───────────────────────────
ipcMain.handle('claude:chat', async (_, systemPrompt, messages, apiKey, provider, frame) => {
  // Auto-detect provider from key prefix if not specified
  if (!provider) {
    if (apiKey && (apiKey.startsWith('AIza') || apiKey.startsWith('AQ.'))) provider = 'gemini';
    else if (apiKey && apiKey.startsWith('sk-ant-')) provider = 'claude';
    else if (apiKey && apiKey.startsWith('gsk_')) provider = 'groq';
    else if (apiKey && apiKey.startsWith('sk-or-')) provider = 'openrouter';
    else if (apiKey && apiKey.startsWith('hf_')) provider = 'huggingface';
    else if (apiKey && apiKey.startsWith('sk-') && apiKey.length < 50) provider = 'siliconflow';
    else if (apiKey && apiKey.startsWith('sk-')) provider = 'deepseek';
    else provider = 'claude';
  }

  if (frame && (!['gemini', 'claude', 'openrouter'].includes(provider) || typeof frame !== 'string' || frame.length > 1_000_000 || !/^[A-Za-z0-9+/=]+$/.test(frame))) {
    throw new Error('برای پرسش تصویری از کلید Gemini، Claude یا OpenRouter استفاده کن.');
  }
  const withFrame = (items, image) => frame
    ? items.map((item, index) => index === items.length - 1 ? { ...item, content: [{ type: 'text', text: item.content }, image] } : item)
    : items;
  let url, headers, body, extractText;

  if (provider === 'gemini') {
    const model = 'gemini-2.5-flash';
    // Both AQ. and AIza keys use x-goog-api-key header
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
    const geminiMsgs = messages
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || ' ' }] }))
      .filter(m => m.parts[0].text.trim());
    if (!geminiMsgs.length || geminiMsgs[geminiMsgs.length - 1].role !== 'user') {
      geminiMsgs.push({ role: 'user', parts: [{ text: 'سلام' }] });
    }
    if (frame) geminiMsgs.at(-1).parts.push({ inlineData: { mimeType: 'image/jpeg', data: frame } });
    body = JSON.stringify({
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
      contents: geminiMsgs,
      generationConfig: { maxOutputTokens: 2048 }
    });
    extractText = d => {
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
      return d.candidates[0].content.parts[0].text;
    };

  } else if (provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    body = JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...messages] });
    extractText = d => d.choices[0].message.content;

  } else if (provider === 'siliconflow') {
    url = 'https://api.siliconflow.cn/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    body = JSON.stringify({ model: 'deepseek-ai/DeepSeek-V3', max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...messages] });
    extractText = d => d.choices[0].message.content;

  } else if (provider === 'deepseek') {
    url = 'https://api.deepseek.com/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    body = JSON.stringify({ model: 'deepseek-chat', max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...messages] });
    extractText = d => d.choices[0].message.content;

  } else if (provider === 'openrouter') {
    url = 'https://openrouter.ai/api/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    body = JSON.stringify({ model: frame ? 'google/gemini-3-flash-preview' : 'nvidia/nemotron-3-ultra-550b-a55b:free', max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...withFrame(messages, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + frame } })] });
    extractText = d => d.choices[0].message.content;

  } else if (provider === 'huggingface') {
    url = 'https://router.huggingface.co/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    body = JSON.stringify({ model: 'meta-llama/Llama-3.2-3B-Instruct', max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...messages] });
    extractText = d => d.choices[0].message.content;

  } else if (provider === 'mistral') {
    url = 'https://api.mistral.ai/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    body = JSON.stringify({ model: 'mistral-small-latest', max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...messages] });
    extractText = d => d.choices[0].message.content;

  } else {
    // Claude (Anthropic)
    url = 'https://api.anthropic.com/v1/messages';
    headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    body = JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 2048, system: systemPrompt,
      messages: withFrame(messages, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame } }) });
    extractText = d => d.content[0].text;
  }

  const resp = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(90000) });
  if (!resp.ok) {
    if (frame) throw new Error('سرویس تصویر پاسخ نداد (' + resp.status + ').');
    const errText = await resp.text().catch(() => '');
    throw new Error(errText.slice(0, 400) || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return extractText(data);
});

// ── IPC: OCR page image via AI Vision ────────────────────────────────
ipcMain.handle('book:ocr-page', async (_, imageBase64, apiKey, provider) => {
  if (!provider) {
    if (apiKey && (apiKey.startsWith('AIza') || apiKey.startsWith('AQ.'))) provider = 'gemini';
    else provider = 'claude';
  }

  if (provider === 'gemini') {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
    const body = JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: 'image/png', data: imageBase64 } },
        { text: 'Extract ALL text from this book page image exactly as it appears. Output only the raw text, keeping paragraph breaks. No explanations, no headers, just the text content.' }
      ]}],
      generationConfig: { maxOutputTokens: 4096 }
    });
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body, signal: AbortSignal.timeout(60000)
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.candidates[0].content.parts[0].text;
  } else {
    // Claude (Anthropic) — haiku has vision
    const url = 'https://api.anthropic.com/v1/messages';
    const body = JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
        { type: 'text', text: 'Extract ALL text from this book page image exactly as it appears. Output only the raw text, keeping paragraph structure. No explanations, no preamble.' }
      ]}]
    });
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body, signal: AbortSignal.timeout(60000)
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      throw new Error(err.slice(0, 400) || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    return data.content[0].text;
  }
});

ipcMain.handle('save:textFile', async (_, content, defaultName) => {
  const win = BrowserWindow.getFocusedWindow();
  const { filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName || 'export.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }, { name: 'All Files', extensions: ['*'] }]
  });
  if (!filePath) return false;
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
});

ipcMain.handle('tmdb:details', async (_, movieId, apiKey) => {
  try {
    const url = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${apiKey}&append_to_response=credits&language=en-US`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const m = await res.json();
    return {
      title: m.title,
      original_title: m.original_title,
      overview: m.overview,
      release_date: m.release_date,
      runtime: m.runtime,
      vote_average: m.vote_average,
      genres: m.genres?.map(g => g.name) || [],
      director: m.credits?.crew?.find(c => c.job === 'Director')?.name || null,
      cast: m.credits?.cast?.slice(0, 5).map(c => c.name) || [],
      poster_path: m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
      backdrop_path: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : null,
    };
  } catch { return null; }
});

// ── IPC: Movie poster fallback (Deezer movie OST search) ──────────────
ipcMain.handle('cover:fetchMoviePoster', async (_, title) => {
  try {
    const q = encodeURIComponent(title + ' soundtrack');
    const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=3`, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    if (data.data?.length) {
      return data.data[0].album?.cover_big || data.data[0].album?.cover_medium || null;
    }
  } catch {}
  // Try plain title search
  try {
    const q = encodeURIComponent(title);
    const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.data?.length) return data.data[0].album?.cover_big || null;
  } catch {}
  return null;
});
