'use strict';
const { app, ipcMain, dialog, nativeTheme, shell, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');
const C    = require('./common');

nativeTheme.themeSource = 'dark';
let mainWindow = null;

// ── Open folder dialog ───────────────────────────────────────────
ipcMain.handle('open-folder-dialog', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select PDF Library Folder',
    buttonLabel: 'Select Folder',
  });
  return r.canceled ? null : r.filePaths[0];
});

// ── Recursive scan ───────────────────────────────────────────────
// Builds a tree node for any folder, arbitrary depth:
//   { type:'folder', name, path, children:[...], pdfCount, totalPdfCount }
//   { type:'pdf', name, path, size }
// Empty folders (no PDFs anywhere inside, recursively) are pruned.

function getDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  } catch { return []; }
}
function getPDFs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.pdf'))
      .map(e => {
        const fp = path.join(dir, e.name);
        try { return { name: e.name, path: fp, size: fs.statSync(fp).size }; }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a,b) => a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
  } catch { return []; }
}

function buildTree(dirPath, dirName) {
  const subDirs = getDirs(dirPath);
  const pdfs    = getPDFs(dirPath);

  const childFolders = subDirs
    .map(d => buildTree(path.join(dirPath, d.name), d.name))
    .filter(Boolean); // prune empty branches

  const pdfNodes = pdfs.map(p => ({ type: 'pdf', name: p.name, path: p.path, size: p.size, courseName: dirName }));

  const children = [...childFolders, ...pdfNodes];
  if (children.length === 0) return null; // empty folder, prune

  const totalPdfCount = childFolders.reduce((sum, c) => sum + c.totalPdfCount, 0) + pdfNodes.length;

  return {
    type: 'folder',
    name: dirName,
    path: dirPath,
    children,
    directPdfCount: pdfNodes.length,
    totalPdfCount,
  };
}

ipcMain.handle('scan-root', async (e, rootPath) => {
  const name = path.basename(rootPath) || rootPath;
  const tree = buildTree(rootPath, name);
  if (!tree) return { mode: 'empty' };
  return { mode: 'tree', tree };
});

// ── Persistence ──────────────────────────────────────────────────
ipcMain.handle('load-progress', ()         => C.readJson(C.userFile('pdf-progress.json'), {}));
ipcMain.handle('save-progress', (e, data)  => C.writeJson(C.userFile('pdf-progress.json'), data));
ipcMain.handle('load-recent',   ()         => C.readJson(C.userFile('recent-paths.json'), []));
ipcMain.handle('save-recent',   (e, paths) => C.writeJson(C.userFile('recent-paths.json'), paths.slice(0, 2)));
ipcMain.handle('load-starred',  ()         => C.readJson(C.userFile('pdf-starred.json'), {}));
ipcMain.handle('save-starred',  (e, data)  => C.writeJson(C.userFile('pdf-starred.json'), data));

// ── Misc ─────────────────────────────────────────────────────────
ipcMain.handle('show-in-folder',    (e, fp)   => shell.showItemInFolder(fp));
ipcMain.handle('copy-to-clipboard', (e, text) => { clipboard.writeText(String(text)); });
ipcMain.handle('open-external',     (e, fp)   => shell.openPath(fp));

// ── App lifecycle ─────────────────────────────────────────────────
if (C.singleInstance(() => mainWindow)) {
  C.boot('pdfs-vault', () => {
    mainWindow = C.createMainWindow({ width: 1400, height: 880, minWidth: 900, minHeight: 600, plugins: true });
  });
}
