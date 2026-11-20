const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openAudioFiles:  ()             => ipcRenderer.invoke('dialog:openAudioFiles'),
  openAudioFolder: ()             => ipcRenderer.invoke('dialog:openAudioFolder'),
  getMeta:         (p)            => ipcRenderer.invoke('audio:getMeta', p),
  fetchLyrics:     (artist, title)=> ipcRenderer.invoke('lyrics:fetch', artist, title),
  translate:       (text)         => ipcRenderer.invoke('translate:toFarsi', text),
  fetchInfo:       (artist, title)=> ipcRenderer.invoke('info:fetch', artist, title),
  fetchCover:      (artist, title)=> ipcRenderer.invoke('cover:fetch', artist, title),
});
