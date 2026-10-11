'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const nativeFrame = process.argv.includes('--vault-native-frame=1');
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.toggle('native-frame', nativeFrame);
});

contextBridge.exposeInMainWorld('api', {
  openFolder:     ()    => ipcRenderer.invoke('open-folder-dialog'),
  scanRoot:       (p, token) => ipcRenderer.invoke('scan-root', p, token),
  cancelScan:     ()    => ipcRenderer.invoke('cancel-scan'),
  getScanCache:   (p)   => ipcRenderer.invoke('get-scan-cache', p),
  listImages:     (d)   => ipcRenderer.invoke('list-images', d),
  countPages:     (ds)  => ipcRenderer.invoke('count-pages', ds),
  onScanBatch:    (cb)  => ipcRenderer.on('scan-batch',    (_e, d) => cb(d)),
  onScanProgress: (cb)  => ipcRenderer.on('scan-progress', (_e, d) => cb(d)),
  onScanDone:     (cb)  => ipcRenderer.on('scan-done',     (_e, d) => cb(d)),
  loadProgress:   ()    => ipcRenderer.invoke('load-progress'),
  saveProgress:   (d)   => ipcRenderer.invoke('save-progress', d),
  loadRecent:     ()    => ipcRenderer.invoke('load-recent'),
  saveRecent:     (ps)  => ipcRenderer.invoke('save-recent', ps),
  showInFolder:   (p)   => ipcRenderer.invoke('show-in-folder', p),
  copyClip:       (t)   => ipcRenderer.invoke('copy-to-clipboard', t),
  getPdfThumb:    (p)   => ipcRenderer.invoke('get-pdf-thumbnail', p),
  winMin:   () => ipcRenderer.send('window-minimize'),
  winMax:   () => ipcRenderer.send('window-maximize'),
  winClose: () => ipcRenderer.send('window-close'),
  winFs:    () => ipcRenderer.send('toggle-fullscreen'),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return f.path || ''; } },
});
