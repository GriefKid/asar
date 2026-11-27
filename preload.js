const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Music player
  openAudioFiles:  ()             => ipcRenderer.invoke('dialog:openAudioFiles'),
  openAudioFolder: ()             => ipcRenderer.invoke('dialog:openAudioFolder'),
  getMeta:         (p)            => ipcRenderer.invoke('audio:getMeta', p),
  mediaFileUrl:    (p)            => ipcRenderer.invoke('file:media-url', p),
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
  ocrPage:           (img64, key, prov)    => ipcRenderer.invoke('book:ocr-page', img64, key, prov),
  // Subtitles (subdl)
  subtitleSearch:    (title, year, key, fileName, videoPath, imdbId) => ipcRenderer.invoke('subtitle:search', title, year, key, fileName, videoPath, imdbId),
  subtitleDownload:  (fileId, key)      => ipcRenderer.invoke('subtitle:download', fileId, key),
  subtitleTranslate: (cues)             => ipcRenderer.invoke('subtitle:translate', cues),
  fetchMoviePoster:  (title)            => ipcRenderer.invoke('cover:fetchMoviePoster', title),
  fetchImage:        (url)              => ipcRenderer.invoke('image:fetch', url),
  // Claude AI
  claudeChat: (sys, msgs, key, provider, frame) => ipcRenderer.invoke('claude:chat', sys, msgs, key, provider, frame),
  saveTextFile: (content, name) => ipcRenderer.invoke('save:textFile', content, name),
  // Window controls
  minimizeWindow:  () => ipcRenderer.invoke('window:minimize'),
  toggleWindowFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  onWindowFullscreen: (cb) => ipcRenderer.on('window:fullscreen-changed', (_, fullscreen) => cb(fullscreen)),
  beginWindowDrag: () => ipcRenderer.send('window:drag-start'),
  moveWindowDrag:  () => ipcRenderer.send('window:drag-move'),
  endWindowDrag:   () => ipcRenderer.send('window:drag-end'),
  closeWindow:     () => ipcRenderer.invoke('window:close'),
  quitApp:         () => ipcRenderer.invoke('app:quit'),
  // Main app — open sub-apps
  openMusicPlayer:   ()                    => ipcRenderer.invoke('app:open-music'),
  openVideoPlayer:   ()                    => ipcRenderer.invoke('app:open-video'),
  openBookReader:    ()                    => ipcRenderer.invoke('app:open-book'),
  openWriter:        ()                    => ipcRenderer.invoke('app:open-writer'),
  downloadItem:      (item)               => ipcRenderer.invoke('lib:download', item),
  // Library sync (sub-apps → main library)
  addToLibrary:    (item)  => ipcRenderer.invoke('lib:addItem', item),
  onLibraryItem:   (cb)    => ipcRenderer.on('lib:item-added', (_, item) => cb(item)),
  // Open sub-apps with a specific file (second monitor)
  openBookReaderWithFile:  (path) => ipcRenderer.invoke('app:open-book-file', path),
  openVideoPlayerWithFile: (path) => ipcRenderer.invoke('app:open-video-file', path),
  openMusicPlayerWithFile: (path) => ipcRenderer.invoke('app:open-music-file', path),
  // Sub-apps receive file open requests
  onOpenFile: (cb) => {
    ipcRenderer.on('open:file', (_, path) => cb(path));
    ipcRenderer.send('open:file-ready');
  },
});
