<div align="center">

# 📚 Manga Vault

**A local manga & manhwa reader — Catppuccin Mocha theme.**

[![Electron](https://img.shields.io/badge/Electron-31-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-Arch%20Linux%20%2F%20omarchy-1793D1?style=flat-square&logo=linux&logoColor=white)](#)
[![Theme](https://img.shields.io/badge/Theme-Catppuccin%20Mocha-cba6f7?style=flat-square)](https://catppuccin.com/)

</div>

Part of **[Local Vaults Suite](../../README.md)**.

<div align="center">
<img src="./screenshots/manga-vault.png" width="49%" alt="Manga Vault welcome screen"/>
<img src="./screenshots/manga-vault-1.png" width="49%" alt="Manga Vault library grid with read progress"/>
</div>

## ✨ Features

- **Direct `file://` loading** — no blob URLs filling up RAM, pages load straight from disk
- **Read Progress** — remembers what you've read, persists after closing the app
- **Continue Reading** — jumps back to the last chapter you opened
- **Library View** — grid with thumbnails and progress badges
- **Chapter Grid** — chapters with Read/Current indicators
- **Reader modes** — Normal / Compact / Fit Width / Wide
- **Chapter progress bar** under the header, moves as you scroll
- **Auto-hide header** — hides while reading, reappears when you move the mouse
- **Right-click zoom** — right-click any page to open it fullsize
- **Keyboard** — `→` / `←` next/previous chapter, `Esc` back, `F` fullscreen
- **Sort** — A→Z, Z→A, By Progress, Most Read
- **Instant search** in the library
- **PDF-volume support** — PDF and image chapters can mix inside the same manga folder; PDF volumes get a real thumbnail of their first page

## 📁 Supported structure

```text
Manga_And_Manhwa/        ← open this as a Library
├── BERSERK/
│   ├── Chapter_1/
│   │   ├── 001.jpg
│   │   └── ...
│   └── Chapter_2/
└── Fight Class 3/
    ├── Chapter_1/
    └── ...
```

Open the root as a **Library**, open a single manga folder directly, or just drag & drop a folder onto the welcome screen.

## 🚀 Install (Arch Linux / omarchy)

```bash
chmod +x install.sh
./install.sh
```

Installs to `~/.local/share/manga-vault`, sets up Electron on first run, and adds a `manga-vault` launcher + desktop entry (searchable in `rofi`/`wofi` as **manga** or **vault**).

Run it:

```bash
manga-vault
```

## 🛠️ Development

```bash
npm install
npm start
```

## 🗑️ Uninstall

```bash
~/.local/share/manga-vault/uninstall.sh
```

---

<div align="center">

Built by **[Diea Abdeltwab](https://github.com/diea-abdeltwab)** — part of [Local Vaults Suite](../../README.md) 🇪🇬

</div>
