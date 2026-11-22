const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

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

function createMusicPlayer() {
  musicWindow = new BrowserWindow({ fullscreen: true, frame: false, backgroundColor: '#04040C', icon: APP_ICON, webPreferences: WEB_PREFS, show: false });
  musicWindow.loadFile('src/apps/music-player/index.html');
  musicWindow.once('ready-to-show', () => musicWindow.show());
  musicWindow.on('closed', () => { musicWindow = null; });
}

function createVideoPlayer() {
  videoWindow = new BrowserWindow({ fullscreen: true, frame: false, backgroundColor: '#04040C', icon: APP_ICON, webPreferences: WEB_PREFS, show: false });
  videoWindow.loadFile('src/apps/video-player/index.html');
  videoWindow.once('ready-to-show', () => videoWindow.show());
  videoWindow.on('closed', () => { videoWindow = null; });
}

function createMainApp() {
  mainWindow = new BrowserWindow({ fullscreen: true, frame: false, backgroundColor: '#04040C', icon: APP_ICON, webPreferences: WEB_PREFS, show: false });
  mainWindow.loadFile('src/main-app/index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createBookReader() {
  bookWindow = new BrowserWindow({ fullscreen: true, frame: false, backgroundColor: '#04040C', icon: APP_ICON, webPreferences: WEB_PREFS, show: false });
  bookWindow.loadFile('src/apps/book-reader/index.html');
  bookWindow.once('ready-to-show', () => bookWindow.show());
  bookWindow.on('closed', () => { bookWindow = null; });
}

function createWriter() {
  writerWindow = new BrowserWindow({ width: 1100, height: 740, frame: false, backgroundColor: '#0f0f13', icon: APP_ICON, webPreferences: WEB_PREFS, show: false });
  writerWindow.loadFile('src/apps/writer/index.html');
  writerWindow.once('ready-to-show', () => writerWindow.show());
  writerWindow.on('closed', () => { writerWindow = null; });
}

// ── IPC: Open sub-apps ─────────────────────────────────────────────────
ipcMain.handle('app:open-music', () => {
  if (musicWindow) { musicWindow.focus(); return; }
  createMusicPlayer();
});
ipcMain.handle('app:open-video', () => {
  if (videoWindow) { videoWindow.focus(); return; }
  createVideoPlayer();
});
ipcMain.handle('app:open-book', () => {
  if (bookWindow) { bookWindow.focus(); return; }
  createBookReader();
});
ipcMain.handle('app:open-writer', () => {
  if (writerWindow) { writerWindow.focus(); return; }
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
ipcMain.handle('app:open-book-file', async (_, filePath) => {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const second = displays.find(d => d.id !== primary.id);

  if (!bookWindow || bookWindow.isDestroyed()) {
    createBookReader();
    await new Promise(resolve => bookWindow.once('ready-to-show', resolve));
  } else {
    bookWindow.focus();
  }
  if (second) bookWindow.setBounds(second.workArea);

  setTimeout(() => {
    if (bookWindow && !bookWindow.isDestroyed()) {
      bookWindow.webContents.send('open:file', filePath);
    }
  }, 600);
});

ipcMain.handle('app:open-video-file', async (_, filePath) => {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const second = displays.find(d => d.id !== primary.id);

  if (!videoWindow || videoWindow.isDestroyed()) {
    createVideoPlayer();
    await new Promise(resolve => videoWindow.once('ready-to-show', resolve));
  } else {
    videoWindow.focus();
  }
  if (second) videoWindow.setBounds(second.workArea);

  setTimeout(() => {
    if (videoWindow && !videoWindow.isDestroyed()) {
      videoWindow.webContents.send('open:file', filePath);
    }
  }, 600);
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
ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});
ipcMain.handle('app:quit', () => {
  app.quit();
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
  return fs.readFileSync(result.filePaths[0], 'utf8');
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
  // Strip leading order numbers like "0001 - ", "12. ", "003-" from filename-based titles
  const cleanTitle = title
    .replace(/^\d{1,4}\s*[-–—.]\s*/, '')   // "0001 - " or "001." at start
    .replace(/[_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // ── Try Google Books first ──
  try {
    const q = encodeURIComponent(cleanTitle);
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(cleanTitle)}&maxResults=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      // Pick first result that has a cover
      const item = (data.items || []).find(i => i.volumeInfo?.imageLinks) || data.items?.[0];
      if (item) {
        const vol = item.volumeInfo;
        const thumb = vol.imageLinks?.thumbnail || vol.imageLinks?.smallThumbnail || null;
        const cover = thumb ? thumb.replace('http:', 'https:').replace('zoom=1', 'zoom=5') : null;
        if (cover) {
          return {
            title: vol.title || cleanTitle,
            authors: vol.authors || [],
            description: vol.description || null,
            cover,
            publishedDate: vol.publishedDate || null,
            categories: vol.categories || [],
          };
        }
        // Google found it but no cover — still return metadata, try OL for cover below
      }
    }
  } catch {}

  // ── Fallback: Open Library ──
  try {
    const olUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(cleanTitle)}&fields=key,title,author_name,cover_i,first_publish_year&limit=5`;
    const olRes = await fetch(olUrl, { signal: AbortSignal.timeout(8000) });
    if (olRes.ok) {
      const olData = await olRes.json();
      const olItem = (olData.docs || []).find(d => d.cover_i) || olData.docs?.[0];
      if (olItem) {
        const cover = olItem.cover_i
          ? `https://covers.openlibrary.org/b/id/${olItem.cover_i}-L.jpg`
          : null;
        return {
          title: olItem.title || cleanTitle,
          authors: olItem.author_name || [],
          description: null,
          cover,
          publishedDate: olItem.first_publish_year ? String(olItem.first_publish_year) : null,
          categories: [],
        };
      }
    }
  } catch {}

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
  const buf = fs.readFileSync(filePath);
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
      return zlib.gunzipSync(buf).toString('utf8');
    } else if (magic === '504b') {
      const zip = new AdmZip(buf);
      const sub = zip.getEntries().find(e => /\.(srt|ass|ssa|vtt)$/i.test(e.entryName));
      return sub ? sub.getData().toString('utf8') : null;
    } else {
      return buf.toString('utf8');
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
ipcMain.handle('claude:chat', async (_, systemPrompt, messages, apiKey, provider) => {
  // Auto-detect provider from key prefix if not specified
  if (!provider) {
    if (apiKey && (apiKey.startsWith('AIza') || apiKey.startsWith('AQ.'))) provider = 'gemini';
    else if (apiKey && apiKey.startsWith('gsk_')) provider = 'groq';
    else if (apiKey && apiKey.startsWith('sk-or-')) provider = 'openrouter';
    else if (apiKey && apiKey.startsWith('hf_')) provider = 'huggingface';
    else if (apiKey && apiKey.startsWith('sk-') && apiKey.length < 50) provider = 'siliconflow';
    else if (apiKey && apiKey.startsWith('sk-')) provider = 'deepseek';
    else provider = 'claude';
  }

  let url, headers, body, extractText;

  if (provider === 'gemini') {
    const model = 'gemini-1.5-flash';
    // Both AQ. and AIza keys use x-goog-api-key header
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
    const geminiMsgs = messages
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || ' ' }] }))
      .filter(m => m.parts[0].text.trim());
    if (!geminiMsgs.length || geminiMsgs[geminiMsgs.length - 1].role !== 'user') {
      geminiMsgs.push({ role: 'user', parts: [{ text: 'سلام' }] });
    }
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
    body = JSON.stringify({ model: 'nvidia/nemotron-3-ultra-550b-a55b:free', max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...messages] });
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
    body = JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 2048, system: systemPrompt, messages });
    extractText = d => d.content[0].text;
  }

  const resp = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(90000) });
  if (!resp.ok) {
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
