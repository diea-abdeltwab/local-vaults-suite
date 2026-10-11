<div align="center">

# 📄 PDFs Vault

**A local PDF library browser, built for deep nested folders — Catppuccin Mocha theme.**

[![Electron](https://img.shields.io/badge/Electron-31-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%C2%B7%20Fedora%20%2F%20GNOME%20%2F%20Arch-1793D1?style=flat-square&logo=linux&logoColor=white)](#)
[![Theme](https://img.shields.io/badge/Theme-Catppuccin%20Mocha-cba6f7?style=flat-square)](https://catppuccin.com/)

</div>

Part of **[Local Vaults Suite](../../README.md)**.

<div align="center">
<img src="./screenshots/pdfs-vault.png" width="49%" alt="PDFs Vault welcome screen"/>
<img src="./screenshots/pdfs-vault-1.png" width="49%" alt="PDFs Vault breadcrumb browser with reading progress"/>
</div>

Built for deep, nested structures like Coursera/DataCamp course exports (`Category → Track → Course → Module → chapter1.pdf`) — but works for any folder of PDFs.

## ✨ Features

- **Recursive scan, any depth** — point it at a root folder and it walks the entire tree, no matter how deeply the PDFs are nested. Folders with no PDFs anywhere inside are skipped automatically.
- **Breadcrumb navigation** — click into category → course → module like a file manager, with a clickable trail back up
- **Global search** — search PDF filenames across the *entire* scanned tree from any screen
- **Reading progress** — opened PDFs are marked read; folders show a progress bar / percentage / "done" badge once everything inside has been opened at least once
- **Starring** — star any PDF for quick access via the ★ Starred view
- **In-app reader** — embedded viewer with Prev/Next to move through every PDF in the current folder
- **Recent folders** — the last 2 opened roots are remembered on the welcome screen
- **Drag & drop** or **Open Folder** dialog to pick your library root

## 🚀 Install (Fedora / GNOME · Arch · any Linux)

From the repo root (two folders up) — installs the shared Electron runtime once, then the app:

```bash
./install.sh pdfs-vault        # or just ./install.sh for all three apps
```

Run it from the app grid (press Super, type **vault**) or from a terminal:

```bash
pdfs-vault
```

- **Offline-proof:** Electron is downloaded **once** into `~/.local/share/local-vaults/runtime` and shared by all three apps. The launcher runs it directly (no `npm`/`npx`), so the app starts with no internet, even right after a reboot.
- **Window bar:** on GNOME/KDE you get the normal desktop title bar. On tiling WMs (Hyprland, Sway, i3…) the app draws its own coloured window dots. Force either with `VAULT_FRAME=native` / `VAULT_FRAME=custom` (or `pdfs-vault --frame=custom`).
- Optional native Wayland rendering: `VAULT_WAYLAND=1 pdfs-vault`.

## 🛠️ Development

Use the shared runtime instead of a per-app `node_modules`:

```bash
cd apps/pdfs-vault
~/.local/share/local-vaults/runtime/node_modules/.bin/electron .
```

`src/common.js` is identical in all three apps (window handling, atomic JSON saves, `localfile://` protocol) — if you change it, copy it to the other two.

## 📖 Usage

1. Open the app, then either drag a folder onto the window or click **Open Folder** and pick the root.
2. Browse: each screen shows the subfolders and any PDFs directly inside the current one. Click a folder to go deeper, click a PDF to read it.
3. Use the titlebar search to find a PDF by name anywhere in the tree.
4. Star a PDF from its card or from the reader; revisit everything you've starred via **★ Starred**.

## 📝 Notes

- Folders that contain *only* PDFs (no subfolders) get a 📕 "leaf" icon; folders that still contain subfolders get a 📂 icon.
- Progress and stars are stored locally under `~/.config/pdfs-vault/`, keyed by full file path — they persist across restarts as long as files aren't moved or renamed.

## 🗑️ Uninstall

```bash
~/.local/share/local-vaults/uninstall.sh pdfs-vault   # keeps Electron + your saved progress
~/.local/share/local-vaults/uninstall.sh --runtime --data   # remove everything
```

---

<div align="center">

Built by **[Diea Abdeltwab](https://github.com/diea-abdeltwab)** — part of [Local Vaults Suite](../../README.md) 🇪🇬

</div>
