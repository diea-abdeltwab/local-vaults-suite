<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=12&height=220&section=header&text=Local%20Vaults%20Suite&fontSize=55&fontColor=fff&animation=fadeIn&fontAlignY=35&desc=Local-first%20Electron%20apps%20%E2%80%94%20one%20Catppuccin%20Mocha%20family&descAlignY=55&descSize=18" width="100%"/>

<br/>

[![Made with Electron](https://img.shields.io/badge/Made%20with-Electron-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![GNOME](https://img.shields.io/badge/Fedora%20%2F%20GNOME-primary-4A86CF?style=for-the-badge&logo=gnome&logoColor=white)](./gnome)
[![Hyprland](https://img.shields.io/badge/Hyprland%20%2F%20omarchy-edition-58E1FF?style=for-the-badge&logo=linux&logoColor=white)](./hyprland)
[![Theme](https://img.shields.io/badge/Theme-Catppuccin%20Mocha-cba6f7?style=for-the-badge&logo=windowsterminal&logoColor=white)](https://catppuccin.com/)
[![License](https://img.shields.io/badge/License-MIT-a6e3a1?style=for-the-badge)](#-license)

<img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&size=20&duration=3000&pause=800&color=CBA6F7&center=true&vCenter=true&width=700&lines=Local+apps.+Zero+cloud.+Zero+tracking.;Your+files%2C+your+disk%2C+your+rules.;Built+for+Fedora+%2F+GNOME+%F0%9F%9A%80" alt="Typing SVG" />

</div>

<br/>

## 🗃️ What is this?

**Local Vaults Suite** is a family of small, fast, **fully local** Electron apps — one per media type — for people who keep large personal libraries on disk (manga, PDFs, images, movies, code, music…) and just want a clean, native-feeling browser for them. No cloud sync, no accounts, no telemetry — point an app at a folder and it just works.

<div align="center">

<img src="./gnome/screenshots/local-vaults-suite.png" width="480" alt="Image Vault, Manga Vault and PDFs Vault in the GNOME app launcher"/>

<sub>Every vault, one keystroke away — press <b>Super</b>, type <code>vault</code>.</sub>

</div>

---

## 🧭 Pick your edition

This repository ships the suite in two editions:

| | 🐧 **[GNOME edition](./gnome)** — *main* | 🪟 **[Hyprland edition](./hyprland)** |
|---|---|---|
| **For** | **Fedora / GNOME** (also runs on any Linux) | Arch Linux / [omarchy](https://omarchy.org/) (Hyprland) |
| **Apps** | 📚 Manga · 📄 PDFs · 🖼️ Image | 🎬 Cinema · 📚 Manga · 📄 PDFs · 💻 Code · 🎵 Music · 📺 Video · 🖼️ Image |
| **Window bar** | Native GNOME title bar | Frameless, own window dots |
| **Install** | One shared installer, **one shared offline Electron** | One installer per app |
| **Big libraries** | Worker-thread scanning, thumbnail cache, virtual scroll, preloading | Original implementation |
| **Extras** | HEIC/HEIF photos, mixed image-chapter + PDF-volume series, clear "can't preview" diagnostics | — |
| **Docs** | [gnome/README.md](./gnome/README.md) | [hyprland/README.md](./hyprland/README.md) |

> **On Fedora / GNOME? Use the GNOME edition.** It is the one that is actively developed and tested.

---

## 🚀 Quick Start (GNOME edition)

> **Needs `node` + `npm` once** — only to download Electron the first time.
> Fedora: `sudo dnf install -y nodejs npm`

```bash
git clone https://github.com/diea-abdeltwab/local-vaults-suite.git
cd local-vaults-suite/gnome
chmod +x install.sh
./install.sh                 # Manga Vault + PDFs Vault + Image Vault
# or pick some:
./install.sh manga-vault pdfs-vault
```

Then open them from the launcher (press **Super**, type `vault`) or from a terminal:

```bash
manga-vault
pdfs-vault
image-vault
```

Uninstall any time with `~/.local/share/local-vaults/uninstall.sh` (see the [GNOME README](./gnome/README.md#-quick-start) for all options).

---

## 📸 A look at the GNOME edition

<div align="center">

### 📚 Manga Vault

<img src="./gnome/screenshots/manga-vault.png" width="100%" alt="Manga Vault library grid with covers, chapter counts and read progress"/>

<br/><br/>

### 🖼️ Image Vault

<img src="./gnome/screenshots/image-vault.png" width="100%" alt="Image Vault masonry gallery with 3,500+ images"/>

<br/><br/>

### 📄 PDFs Vault

<img src="./gnome/screenshots/pdfs-vault.png" width="100%" alt="PDFs Vault breadcrumb browser showing a course folder with sub-folders and PDFs"/>

</div>

---

## ✨ Highlights of the GNOME edition

- 📴 **Works offline** — one shared Electron runtime is installed *once*; the launchers never call `npm`/`npx`, so the apps start with no internet, even right after a reboot.
- 🧠 **Built for huge libraries** — scanning runs in a worker thread, so the window never freezes (tested on a 300,000-file library). Details: [Built for big libraries](./gnome/README.md#-built-for-big-libraries).
- 🔀 **Mixed series** — image chapters *and* PDF volumes in the same manga, side by side or in a `PDF/` sub-folder.
- 📷 **HEIC/HEIF photos** — decoded with a bundled WebAssembly decoder, no system codec needed.
- 🪟 **Native GNOME window bar** — close, minimise, drag and resize like any other app.
- 🔒 `contextIsolation` + a minimal `preload.js` bridge — no Node access from the renderer.

---

## 🗂️ Repository layout

```text
local-vaults-suite/
├── gnome/                      ← 🐧 Fedora / GNOME edition (main)
│   ├── install.sh · uninstall.sh · lib/     ← one shared installer
│   ├── apps/
│   │   ├── manga-vault/
│   │   ├── pdfs-vault/
│   │   └── image-vault/
│   ├── screenshots/
│   ├── CHANGELOG.md
│   └── README.md
├── hyprland/                   ← 🪟 Arch / omarchy edition (original, seven apps)
│   ├── apps/
│   │   ├── cinema-vault/  manga-vault/  pdfs-vault/  code-vault/
│   │   └── music-vault/   video-vault/  image-vault/
│   └── README.md
└── LICENSE
```

---

## 🎨 Design language

<div align="center">

| Color | Hex | Role |
|---|---|---|
| 🟣 Mauve | `#CBA6F7` | Primary accent |
| 🌸 Pink | `#F5C2E7` | Secondary accent |
| 💜 Lavender | `#B4BEFE` | Links, highlights |
| 🟢 Green | `#A6E3A1` | Success / progress |
| 🔵 Blue | `#89B4FA` | Info |
| ⬛ Base | `#1E1E2E` | Background |
| ⬜ Text | `#CDD6F4` | Foreground text |

</div>

Full [Catppuccin Mocha](https://catppuccin.com/palette/) palette across every screen.

---

## 🧑‍💻 About the author

<div align="center">

**Diea Abdeltwab** — Data Engineer · Software Engineer · Cairo, Egypt 🇪🇬

*Turning raw data into reliable systems — and, on the side, building the local-first tools I actually want to use.*

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/diea-abdeltwab/)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/diea-abdeltwab)
[![Email](https://img.shields.io/badge/Email-D14836?style=for-the-badge&logo=gmail&logoColor=white)](mailto:dieaabdeltwab2024@gmail.com)

</div>

---

## 📜 License

MIT — use it, fork it, theme it however you like. See [`LICENSE`](./LICENSE). Third-party components (Electron, libheif-js, bundled fonts) are listed in the [GNOME README](./gnome/README.md#-third-party).

<div align="center">

⭐ **If any of these vaults are useful to you, a star helps a lot!** ⭐

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=12&height=120&section=footer" width="100%"/>

</div>
