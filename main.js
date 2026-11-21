const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let musicWindow = null;
let videoWindow = null;
let bookWindow = null;

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
  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.lyrics || null;
  } catch {
    return null;
  }
});

// ── IPC: Translate ─────────────────────────────────────────────────
ipcMain.handle('translate:toFarsi', async (_, text) => {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fa&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    return data[0].map(s => s[0]).join('');
  } catch {
    return null;
  }
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

// ── IPC: Cover fetch (iTunes → Deezer fallback) ───────────────────
ipcMain.handle('cover:fetch', async (_, artist, title) => {
  const q = encodeURIComponent(`${artist} ${title}`);

  // 1. iTunes
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&limit=3`, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    if (data.results?.length) return data.results[0].artworkUrl100.replace('100x100', '600x600bb');
  } catch {}

  // 2. Deezer — better coverage for Persian/Iranian music
  try {
    const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    if (data.data?.length) return data.data[0].album?.cover_big || data.data[0].album?.cover_medium || null;
  } catch {}

  // 3. Deezer search by artist only (فارسی اسم هنرمند)
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
    filters: [{ name: 'Subtitle Files', extensions: ['srt','vtt'] }]
  });
  if (result.canceled) return null;
  return fs.readFileSync(result.filePaths[0], 'utf8');
});

// ── IPC: TMDB search ───────────────────────────────────────────────────
ipcMain.handle('tmdb:search', async (_, title, apiKey) => {
  try {
    const q = encodeURIComponent(title);
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${q}&language=en-US&page=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results?.length) return null;
    const m = data.results[0];
    return {
      id: m.id,
      title: m.title,
      original_title: m.original_title,
      overview: m.overview,
      release_date: m.release_date,
      vote_average: m.vote_average,
      poster_path: m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
      backdrop_path: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : null,
      genre_ids: m.genre_ids
    };
  } catch { return null; }
});

// ── IPC: Book metadata (Google Books) ────────────────────────────────
ipcMain.handle('book:fetchMeta', async (_, title) => {
  try {
    const q = encodeURIComponent(title.replace(/[_\-\.]/g, ' ').trim());
    const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items?.[0];
    if (!item) return null;
    const vol = item.volumeInfo;
    const thumb = vol.imageLinks?.thumbnail || vol.imageLinks?.smallThumbnail || null;
    return {
      title:       vol.title || null,
      authors:     vol.authors || [],
      description: vol.description || null,
      cover:       thumb ? thumb.replace('http:', 'https:').replace('zoom=1', 'zoom=3') : null,
      publishedDate: vol.publishedDate || null,
      categories:  vol.categories || [],
    };
  } catch { return null; }
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

// ── IPC: OpenSubtitles search ──────────────────────────────────────────
ipcMain.handle('subtitle:search', async (_, title, year, apiKey) => {
  try {
    let url = `https://api.opensubtitles.com/api/v1/subtitles?query=${encodeURIComponent(title)}&languages=en&order_by=download_count`;
    if (year) url += `&year=${year}`;
    const res = await fetch(url, {
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json', 'User-Agent': 'LifestyleApp/1.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.data || []).slice(0, 5).map(item => ({
      id: item.id,
      fileId: item.attributes?.files?.[0]?.file_id || null,
      name: item.attributes?.release || '',
      downloads: item.attributes?.download_count || 0,
    })).filter(r => r.fileId);
  } catch { return null; }
});

// ── IPC: OpenSubtitles download ────────────────────────────────────────
ipcMain.handle('subtitle:download', async (_, fileId, apiKey) => {
  try {
    const res = await fetch('https://api.opensubtitles.com/api/v1/download', {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json', 'User-Agent': 'LifestyleApp/1.0' },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.link) return null;
    const srtRes = await fetch(data.link, { signal: AbortSignal.timeout(15000) });
    if (!srtRes.ok) return null;
    return await srtRes.text();
  } catch { return null; }
});

// ── IPC: Claude AI chat ────────────────────────────────────────────────
ipcMain.handle('claude:chat', async (_, systemPrompt, messages, apiKey) => {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(errText.slice(0, 400) || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.content[0].text;
});

ipcMain.handle('save:textFile', async (_, content, defaultName) => {
  const { dialog, BrowserWindow } = require('electron');
  const win = BrowserWindow.getFocusedWindow();
  const { filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName || 'export.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }, { name: 'All Files', extensions: ['*'] }]
  });
  if (!filePath) return false;
  const fs = require('fs');
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
