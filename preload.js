const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Music player
  openAudioFiles:  ()             => ipcRenderer.invoke('dialog:openAudioFiles'),
  openAudioFolder: ()             => ipcRenderer.invoke('dialog:openAudioFolder'),
  getMeta:         (p)            => ipcRenderer.invoke('audio:getMeta', p),
  fetchLyrics:     (artist, title)=> ipcRenderer.invoke('lyrics:fetch', artist, title),
  translate:       (text)         => ipcRenderer.invoke('translate:toFarsi', text),
  fetchInfo:       (artist, title)=> ipcRenderer.invoke('info:fetch', artist, title),
  fetchCover:      (artist, title)=> ipcRenderer.invoke('cover:fetch', artist, title),
  // Video player
  openVideoFiles:    ()                    => ipcRenderer.invoke('dialog:openVideoFiles'),
  openSubtitleFile:  ()                    => ipcRenderer.invoke('dialog:openSubtitleFile'),
  tmdbSearch:        (title, key)          => ipcRenderer.invoke('tmdb:search', title, key),
  tmdbDetails:       (id, key)             => ipcRenderer.invoke('tmdb:details', id, key),
  // Book reader
  openPdfFiles:      ()                    => ipcRenderer.invoke('dialog:openPdfFiles'),
  readFileBuffer:    (path)                => ipcRenderer.invoke('file:readBuffer', path),
  fetchBookMeta:     (title)               => ipcRenderer.invoke('book:fetchMeta', title),
  // Subtitles (OpenSubtitles)
  subtitleSearch:    (title, year, key) => ipcRenderer.invoke('subtitle:search', title, year, key),
  subtitleDownload:  (fileId, key)      => ipcRenderer.invoke('subtitle:download', fileId, key),
  // Claude AI
  claudeChat: (sys, msgs, key) => ipcRenderer.invoke('claude:chat', sys, msgs, key),
  // Window controls
  closeWindow:     () => ipcRenderer.invoke('window:close'),
  quitApp:         () => ipcRenderer.invoke('app:quit'),
  // Main app — open sub-apps
  openMusicPlayer:   ()                    => ipcRenderer.invoke('app:open-music'),
  openVideoPlayer:   ()                    => ipcRenderer.invoke('app:open-video'),
  openBookReader:    ()                    => ipcRenderer.invoke('app:open-book'),
});
