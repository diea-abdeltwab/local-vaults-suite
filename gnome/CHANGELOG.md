# Changelog

What changed compared with the original Arch/omarchy-only apps, and what each release fixed.

## v2.6

- **Image Vault — HEIC / HEIF photos.** Phone photos saved in HEIC (often with a `.jpg` name, e.g. Pinterest/WhatsApp downloads) can't be decoded by the browser engine. They are now decoded in a background worker with a bundled WebAssembly build of libheif (`src/vendor/`, LGPL-3.0, works offline, no system codec needed), converted once to a JPEG preview (max 2560 px) and cached in `~/.config/image-vault/thumbs`. `.heic` / `.heif` files are also listed now. The lightbox shows "Converting photo…" the first time (about 1–3 s for a 12 MP photo); afterwards it is instant. Header sizes of HEIC/AVIF include their rotation flag, so portrait photos get the right tile shape.

## v2.5

- **Image Vault — files that can't be displayed:** instead of an empty box (or a black lightbox), the tile and the lightbox now say **why**: empty file, a web page / error message saved as `.jpg`, HEIC/HEIF, JPEG XL, TIFF, JPEG 2000, arithmetic-coded or 12-bit JPEG, incomplete download, or damaged data — plus **↗ Open with system viewer** and **📂 Show in folder** buttons.

## v2.4

- **Image Vault — blank tiles:** a thumbnail that took too long (busy queue, huge file) left its tile empty. Now a tile still waiting after 1.5 s shows the original picture, every thumbnail job has a 20 s limit and is never duplicated, files that can't be thumbnailed are remembered, thumbnails are encoded as JPEG (faster), the number of parallel jobs follows the CPU, and files that genuinely can't be decoded show a clear "Can't preview this file" card with their name instead of an empty box.
- **Manga Vault — mixed series:** image chapters and PDF volumes can live in the same series, side by side or in a `PDF`/`Volumes`/`Tomes`… sub-folder (any folder holding only PDFs is detected). They are shown in two groups with a swap button; prev/next follows the groups.
- **PDFs Vault:** PDFs open with the thumbnail sidebar collapsed; full names as tooltips.
- **Project layout:** apps moved to `apps/<name>/` (the installer also still accepts the flat layout); new README with screenshots, `LICENSE`, `.gitignore`.

## 🔧 What changed vs. the original apps

**Install / offline**
- Shared runtime + direct launcher (above); the old `install.sh` skipped Electron (`--omit=dev`) so the first launch had to download it through `npx`.
- Removed the forced `GDK_SCALE=1` from the launchers (it made the apps tiny on HiDPI GNOME).
- Google Fonts were loaded from the internet → now bundled locally (`src/fonts`, SIL OFL).

**Bugs fixed**
- Folder/file names containing `#`, `?`, `%` were cut off or failed to load (manga covers, pages, PDFs) → URLs are now encoded properly.
- Folder/series names containing `<`, `&`, quotes broke the manga grid and recent list (unescaped HTML) → escaped.
- Image Vault: typing a **space** in the search box started the slideshow → fixed.
- Images and videos are shown through plain `file://` URLs (fast, seekable, any size). A small `localfile://` protocol exists only for generating thumbnails.
- GPU flags `disable-software-rasterizer` / `enable-zero-copy` could leave a **blank window** when the GPU process can't start → removed.
- Saved window position off-screen (unplugged monitor) made the window invisible → positions are validated.
- A power cut/reboot while saving could corrupt progress/favorites JSON → atomic writes (temp file + rename).
- Window state was written on every pixel of a resize → debounced.
- Manga PDF covers: rendered blank grey in some setups and was cached forever → uses `pdftoppm` when available (ships with Fedora Workstation), otherwise waits until the PDF viewer has really painted; never caches a blank image.
- Dropping a file outside the drop zone navigated the whole UI away → blocked.
- `File.path` (removed in newer Electron) → uses `webUtils.getPathForFile`.
- Image Vault now remembers window size/position, has an app icon, and scans large folders without freezing.
- Added single-instance lock (launching again focuses the open window) and a proper app-id so GNOME groups the window under its icon.

## ⚡ Big libraries & smooth scrolling (v2.1)

**Manga Vault — "Not Responding" on huge libraries.** The scan ran inside the Electron main process (3 `readdir`s + a `stat` for *every* image, then one giant 34 MB message to the UI). On a 300,000-file library that blocked the app for ~9 s, so the desktop showed the "Not Responding" dialog. Now:
- the scan runs in a **worker thread** (`scan-worker.js`) — the app stays responsive no matter how slow the disk is;
- a series now costs only **two directory reads** (its folder + its first chapter, for the cover) instead of opening every chapter folder: 16,000 reads → ≈600 on the 300-series test library — the thing that matters on slow/NTFS/network drives. Many series are read in parallel. Chapter folders that hold no images are dropped when you open the series;
- series appear **as they are found** (first cards in ≈0.5 s) with a live `scanning 120/300` counter;
- only light data is sent: page lists are read **when you open a chapter**, page counts are filled in the background;
- the last scan of each library is **cached** — reopening shows it instantly, then silently re-checks and says "Library updated" if something changed;
- covers (and PDF covers) load only for cards near the screen; off-screen cards are skipped by the browser (`content-visibility`);
- opening a 1,500-page chapter takes ≈0.1 s and loads only the pages near you (before: every not-yet-loaded page was 0 px tall, so "lazy" loading loaded the whole chapter at once);
- hidden macOS junk files (`._001.jpg`) are ignored.

Measured here on a 300-series / 300,000-file library: scan call blocked the main process **8.7 s → 1 ms**, payload **34 MB → streamed in small batches**.

**Image Vault — scroll stutter.**
- Every picture used to be fully decoded at startup just to read its width/height. Sizes now come from the file header (EXIF rotation aware): load time on a 460 MB gallery **6.8 s → 1.0 s**.
- The grid shows small cached **thumbnails** (made once in the background, stored in `~/.config/image-vault/thumbs`, capped at ~1.5 GB); the full file is decoded only in the lightbox.
- Videos play only while visible (before: all of them decoded at once).
- Removed things that repainted constantly while scrolling: the background particle animation (now only on the welcome screen), a blur layer on every tile's ★ button, the shimmer animation on loading tiles, the animated title gradient.

**PDFs Vault — stutter while scrolling image-heavy PDFs.** The page behind the reader kept running an infinite animation and blur layers; they are now off. The PDF itself is drawn by Chromium's built-in viewer, which is slower than GNOME's own viewer on big scanned PDFs, so there is a new **↗** button in the reader that opens the file in the system viewer.

**Still stuttering?** Run `VAULT_DEBUG=1 pdfs-vault` in a terminal: it prints whether the GPU is really used. If `gpu_compositing` / `rasterization` say `disabled_software`, the stutter is the graphics driver (software rendering), not the app.

## 🩹 v2.2 — fixes for problems the v2.1 build introduced

- **Manga Vault showed only 1–2 series.** The "scan finished" message could arrive *before* the last batches of series, so the library was drawn from partial data. Everything now travels on one ordered channel and the finish is handled only after all data (tested 10 cold runs: label always equals cards).
- **Image Vault stayed on "Loading…".** v2.1 served images/videos through a custom protocol that made a 328 MB video take 3.3 s just to start (0.2 s with `file://`), and the gallery waited for every video's metadata. Now: direct `file://`; image **and video** sizes are read from file headers (MP4/WebM/JPEG/PNG/WebP/GIF/BMP/AVIF, rotation aware — a 328 MB video takes <1 ms); videos are never loaded just to measure them; the folder scan runs in a worker with a live "N files" counter; and if sizes take longer than 4 s (slow disk) the gallery opens anyway and re-lays out in the background (scroll position kept).

## 🫥 v2.3 — pictures blinking / appearing late

- **Image Vault:** tiles used to be destroyed 900 px after leaving the screen and rebuilt (blank → skeleton → fade-in) when you scrolled back. Now: ~2 screens of tiles are kept alive and destroyed only far away, thumbnail addresses are remembered (no round-trip when a tile comes back), already-seen pictures show instantly with no fade, the thumbnails closest to the middle of the screen are made first, and while you are *not* scrolling the whole library's thumbnails are prepared quietly in the background (one at a time) so scrolling later never waits. Videos only get their source when close to the screen.
- **Manga Vault:** pages now start loading ~6 screens ahead of where you are (the browser's built-in lazy loading only starts ~1 screen ahead, which is the delay you saw), and the first pages of the next chapter are fetched quietly. Tested on a 1,500-page chapter: every page was already loaded when it scrolled into view. Series covers also load further ahead.

## ✅ How it was tested

On a clean throw-away home folder with Electron 31.7.7: install/uninstall/re-install (second run made **no** npm call), all three apps launched through their real launchers, libraries with names like `Fight Class #3`, `Tom & Jerry's <Best>`, `What?! 100% Real`, `lesson #1.pdf`, nested folders, mp4/webm clips, PDF volumes and covers, reading + progress saving, global search, and a run inside a **network-less namespace** (fonts loaded, zero external requests).
Performance numbers were measured with software rendering (no GPU in the test environment), so they show the relative improvement; real-GPU smoothness and the look of the native GNOME title bar could not be verified there.
