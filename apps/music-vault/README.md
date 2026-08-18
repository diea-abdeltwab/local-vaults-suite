<div align="center">

# 🎵 Music Vault

**A local music & clips player — Catppuccin Mocha theme.**

[![Electron](https://img.shields.io/badge/Electron-31-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-Arch%20Linux%20%2F%20omarchy-1793D1?style=flat-square&logo=linux&logoColor=white)](#)
[![Theme](https://img.shields.io/badge/Theme-Catppuccin%20Mocha-cba6f7?style=flat-square)](https://catppuccin.com/)

</div>

Part of **[Local Vaults Suite](../../README.md)**.

## ✨ Features

- **Direct `file://` playback** — audio streams straight off disk
- **Music + short clips** in one library (MP3/FLAC/WAV/OGG/M4A and common video-clip formats)
- **Cover art detection** — pulls in album art / folder images automatically
- **Subtitle/lyric support** — SRT/ASS/SSA converted to WebVTT for synced lyrics on video clips
- **Play progress & continue listening**, remembered across sessions
- **Recent folders** on the welcome screen
- **Right-click utilities** — show in file manager, copy path

## 🚀 Install (Arch Linux / omarchy)

```bash
chmod +x install.sh
./install.sh
```

Installs to `~/.local/share/music-vault`, sets up Electron on first run, and adds a `music-vault` launcher + desktop entry (searchable in `rofi`/`wofi` as **music** or **vault**).

Run it:

```bash
music-vault
```

## 🛠️ Development

```bash
npm install
npm start
```

## 🗑️ Uninstall

```bash
~/.local/share/music-vault/uninstall.sh
```

---

<div align="center">

Built by **[Diea Abdeltwab](https://github.com/diea-abdeltwab)** — part of [Local Vaults Suite](../../README.md) 🇪🇬

</div>
