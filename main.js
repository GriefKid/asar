const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let musicWindow = null;

function createMusicPlayer() {
  musicWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#04040C',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#08081A',
      symbolColor: '#8585AA',
      height: 32
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    },
    show: false
  });

  musicWindow.loadFile('src/apps/music-player/index.html');

  musicWindow.once('ready-to-show', () => {
    musicWindow.show();
  });

  musicWindow.on('closed', () => {
    musicWindow = null;
  });
}

app.whenReady().then(() => {
  createMusicPlayer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMusicPlayer();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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

// ── IPC: Cover fetch (iTunes) ──────────────────────────────────────
ipcMain.handle('cover:fetch', async (_, artist, title) => {
  try {
    const q = encodeURIComponent(`${artist} ${title}`);
    const url = `https://itunes.apple.com/search?term=${q}&media=music&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    if (!data.results?.length) return null;
    return data.results[0].artworkUrl100.replace('100x100', '300x300');
  } catch {
    return null;
  }
});
