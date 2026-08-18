<div align="center">

# 📺 Video Vault

**A local, YouTube-style video library — Catppuccin Mocha theme.**

[![Electron](https://img.shields.io/badge/Electron-31-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-Arch%20Linux%20%2F%20omarchy-1793D1?style=flat-square&logo=linux&logoColor=white)](#)
[![Theme](https://img.shields.io/badge/Theme-Catppuccin%20Mocha-cba6f7?style=flat-square)](https://catppuccin.com/)

</div>

Part of **[Local Vaults Suite](../../README.md)**.

For that folder of downloaded videos, tutorials, and saved clips that deserves better than a bare file manager — a thumbnail grid you can actually browse.

## ✨ Features

- **Direct `file://` playback** — no re-encoding, no blob URLs
- **Thumbnail grid**, extracted straight from the video files — flat collections or nested folders both work
- **Continue Watching** — resumes exactly where you left off
- **Subtitles** — SRT/ASS/SSA auto-converted to WebVTT
- **Recent folders** remembered on the welcome screen
- **Right-click utilities** — show in file manager, copy path

## 🚀 Install (Arch Linux / omarchy)

```bash
chmod +x install.sh
./install.sh
```

Installs to `~/.local/share/video-vault`, sets up Electron on first run, and adds a `video-vault` launcher + desktop entry (searchable in `rofi`/`wofi` as **video** or **vault**).

Run it:

```bash
video-vault
```

## 🛠️ Development

```bash
npm install
npm start
```

## 🗑️ Uninstall

```bash
~/.local/share/video-vault/uninstall.sh
```

---

<div align="center">

Built by **[Diea Abdeltwab](https://github.com/diea-abdeltwab)** — part of [Local Vaults Suite](../../README.md) 🇪🇬

</div>
