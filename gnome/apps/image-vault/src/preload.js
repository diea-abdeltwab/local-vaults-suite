'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const nativeFrame = process.argv.includes('--vault-native-frame=1');
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.toggle('native-frame', nativeFrame);
});

contextBridge.exposeInMainWorld('electronAPI', {
  openFolderDialog:  ()      => ipcRenderer.invoke('open-folder-dialog'),
  openFileDialog:    ()      => ipcRenderer.invoke('open-file-dialog'),
  scanFolder:        (p)     => ipcRenderer.invoke('scan-folder', p),
  getDims:           (fs)    => ipcRenderer.invoke('get-dims', fs),
  onScanProgress:    (cb)    => ipcRenderer.on('scan-progress', (_e, d) => cb(d)),
  thumbGet:          (p, m, s, w) => ipcRenderer.invoke('thumb-get', p, m, s, w),
  thumbGetMany:      (list)  => ipcRenderer.invoke('thumb-get-many', list),
  thumbSave:         (k, buf)=> ipcRenderer.invoke('thumb-save', k, buf),
  showInFolder:      (p)     => ipcRenderer.invoke('show-in-folder', p),
  openPath:          (p)     => ipcRenderer.invoke('open-path', p),
  probeFile:         (p)     => ipcRenderer.invoke('probe-file', p),
  copyToClipboard:   (t)     => ipcRenderer.invoke('copy-to-clipboard', t),
  loadFavorites:     ()      => ipcRenderer.invoke('load-favorites'),
  saveFavorites:     (favs)  => ipcRenderer.invoke('save-favorites', favs),
  loadRecent:        ()      => ipcRenderer.invoke('load-recent'),
  saveRecent:        (paths) => ipcRenderer.invoke('save-recent', paths),
  minimize:          ()      => ipcRenderer.send('window-minimize'),
  maximize:          ()      => ipcRenderer.send('window-maximize'),
  close:             ()      => ipcRenderer.send('window-close'),
  toggleFullscreen:  ()      => ipcRenderer.send('toggle-fullscreen'),
  // File.path was removed from newer Electron versions — use webUtils
  pathForFile:       (f)     => { try { return webUtils.getPathForFile(f); } catch { return f.path || ''; } },
});
