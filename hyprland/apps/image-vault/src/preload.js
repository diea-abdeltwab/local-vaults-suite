const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  openFolderDialog:  ()      => ipcRenderer.invoke('open-folder-dialog'),
  openFileDialog:    ()      => ipcRenderer.invoke('open-file-dialog'),
  scanFolder:        (p)     => ipcRenderer.invoke('scan-folder', p),
  showInFolder:      (p)     => ipcRenderer.invoke('show-in-folder', p),
  copyToClipboard:   (t)     => ipcRenderer.invoke('copy-to-clipboard', t),
  loadFavorites:     ()      => ipcRenderer.invoke('load-favorites'),
  saveFavorites:     (favs)  => ipcRenderer.invoke('save-favorites', favs),
  loadRecent:        ()      => ipcRenderer.invoke('load-recent'),
  saveRecent:        (paths) => ipcRenderer.invoke('save-recent', paths),
  minimize:          ()      => ipcRenderer.send('window-minimize'),
  maximize:          ()      => ipcRenderer.send('window-maximize'),
  close:             ()      => ipcRenderer.send('window-close'),
  toggleFullscreen:  ()      => ipcRenderer.send('toggle-fullscreen'),
});
