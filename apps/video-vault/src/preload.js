const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  openFolder:      ()    => ipcRenderer.invoke('open-folder-dialog'),
  scanRoot:        (p)   => ipcRenderer.invoke('scan-root', p),
  loadProgress:    ()    => ipcRenderer.invoke('load-progress'),
  saveProgress:    (d)   => ipcRenderer.invoke('save-progress', d),
  loadRecent:      ()    => ipcRenderer.invoke('load-recent'),
  saveRecent:      (ps)  => ipcRenderer.invoke('save-recent', ps),
  showInFolder:    (p)   => ipcRenderer.invoke('show-in-folder', p),
  copyClip:        (t)   => ipcRenderer.invoke('copy-to-clipboard', t),
  openExternal:    (p)   => ipcRenderer.invoke('open-external', p),
  loadSubtitle:    (p)   => ipcRenderer.invoke('load-subtitle', p),
  // Get filesystem path from a dropped File object (Electron 28+)
  getPathForFile:  (f)   => {
    try { return webUtils?.getPathForFile(f) || null; }
    catch { return null; }
  },
  winMin:   () => ipcRenderer.send('window-minimize'),
  winMax:   () => ipcRenderer.send('window-maximize'),
  winClose: () => ipcRenderer.send('window-close'),
  winFs:    () => ipcRenderer.send('toggle-fullscreen'),
});
