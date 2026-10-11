#!/usr/bin/env bash
# Shared helpers for the Local Vaults installer (sourced, not executed).
#
# Layout (everything lives under ~/.local/share, so it survives reboots):
#
#   ~/.local/share/local-vaults/
#       runtime/            ONE shared Electron (installed once, reused by all apps)
#       apps/<name>/        app code only (a few hundred KB, no node_modules)
#   ~/.local/bin/<name>     launcher (runs Electron directly — no npm, no npx, no internet)
#   ~/.local/share/applications/<name>.desktop

APPS_ALL=(image-vault manga-vault pdfs-vault)

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
BASE="$DATA_HOME/local-vaults"
RUNTIME="$BASE/runtime"
APPS_DIR="$BASE/apps"
BIN_DIR="$HOME/.local/bin"
DESK_DIR="$DATA_HOME/applications"
ELECTRON_VERSION="31.7.7"
ELECTRON_BIN="$RUNTIME/node_modules/electron/dist/electron"

log()  { printf '→ %s\n' "$*"; }
ok()   { printf '✓ %s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

app_meta() {  # sets NAME COMMENT CATS KEYS for an app id
  case "$1" in
    image-vault) NAME="Image Vault"; COMMENT="Local image & video gallery";   CATS="Graphics;Viewer;"; KEYS="image;gallery;photos;video;catppuccin;" ;;
    manga-vault) NAME="Manga Vault"; COMMENT="Local Manga & Manhwa Reader";   CATS="Graphics;Viewer;"; KEYS="manga;manhwa;reader;catppuccin;" ;;
    pdfs-vault)  NAME="PDFs Vault";  COMMENT="Local PDF Library Browser";     CATS="Office;Viewer;";   KEYS="pdf;library;documents;catppuccin;" ;;
    *) return 1 ;;
  esac
}

# where an app's sources live: apps/<name> (repo layout) or <name> (flat zip layout)
app_root() {
  if   [ -d "$ROOT/apps/$1/src" ]; then echo "$ROOT/apps/$1"
  elif [ -d "$ROOT/$1/src" ];      then echo "$ROOT/$1"
  else return 1; fi
}

is_app() { local a; for a in "${APPS_ALL[@]}"; do [ "$a" = "$1" ] && return 0; done; return 1; }

# ── shared Electron runtime ──────────────────────────────────────
runtime_ok() {
  [ -x "$ELECTRON_BIN" ] &&
  [ "$(cat "$RUNTIME/node_modules/electron/dist/version" 2>/dev/null)" = "$ELECTRON_VERSION" ]
}

ensure_runtime() {  # $1 = "force" to reinstall
  if [ "${1:-}" != "force" ] && runtime_ok; then
    ok "Electron $ELECTRON_VERSION runtime already installed — no internet needed"
    return 0
  fi

  command -v npm >/dev/null 2>&1 || {
    warn "Node.js / npm is required ONCE to download Electron."
    warn "Fedora:  sudo dnf install -y nodejs npm"
    die  "Install npm, then run ./install.sh again."
  }

  log "Installing the shared Electron $ELECTRON_VERSION runtime (one time, ~250 MB download)..."
  mkdir -p "$RUNTIME"
  cp "$ROOT/lib/runtime-package.json"      "$RUNTIME/package.json"
  cp "$ROOT/lib/runtime-package-lock.json" "$RUNTIME/package-lock.json"
  rm -rf "$RUNTIME/node_modules"

  if ! ( cd "$RUNTIME" && npm ci --no-audit --no-fund ); then
    warn "Could not download Electron — are you offline?"
    warn "Connect to the internet and run ./install.sh again. This is needed only the first time;"
    warn "afterwards the apps start with no internet at all."
    exit 1
  fi
  runtime_ok || die "Electron installed but its binary is missing — try:  ./install.sh --force-runtime"
  ok "Runtime ready: $RUNTIME"
}

# ── per-app install ──────────────────────────────────────────────
install_app() {
  local app="$1"
  is_app "$app" || die "Unknown app: $app (choose from: ${APPS_ALL[*]})"
  local src; src="$(app_root "$app")" || die "Missing source folder for $app (looked in $ROOT/apps/$app and $ROOT/$app)"
  app_meta "$app"

  local dest="$APPS_DIR/$app"
  log "Installing $NAME..."
  rm -rf "$dest"
  mkdir -p "$dest/assets" "$BIN_DIR" "$DESK_DIR"
  cp -r  "$src/src"             "$dest/src"
  cp     "$src/assets/icon.png" "$dest/assets/icon.png"
  cp     "$src/package.json"    "$dest/package.json"

  # Launcher: runs the shared Electron directly. No npx/npm → works offline.
  cat > "$BIN_DIR/$app" <<LAUNCHER
#!/usr/bin/env bash
BASE="\${XDG_DATA_HOME:-\$HOME/.local/share}/local-vaults"
ELECTRON="\$BASE/runtime/node_modules/electron/dist/electron"
if [ ! -x "\$ELECTRON" ]; then
  msg="Electron runtime missing. Run install.sh again (internet needed once)."
  echo "$app: \$msg" >&2
  command -v notify-send >/dev/null 2>&1 && notify-send "$NAME" "\$msg"
  exit 1
fi
exec "\$ELECTRON" "\$BASE/apps/$app" "\$@"
LAUNCHER
  chmod +x "$BIN_DIR/$app"

  cat > "$DESK_DIR/$app.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=$NAME
Comment=$COMMENT
Exec=$BIN_DIR/$app
Icon=$dest/assets/icon.png
Terminal=false
Categories=$CATS
Keywords=$KEYS
StartupNotify=true
StartupWMClass=$app
DESKTOP

  # a legacy per-app install (old installer) just wastes space — tell the user
  if [ -d "$DATA_HOME/$app/node_modules" ]; then
    warn "Old per-app install found at $DATA_HOME/$app (has its own node_modules)."
    warn "Safe to remove:  rm -rf \"$DATA_HOME/$app\""
  fi
  ok "$NAME installed  →  run:  $app"
}

refresh_desktop_db() {
  update-desktop-database "$DESK_DIR" >/dev/null 2>&1 || true
}

# keep an uninstaller next to the data so it works after the source folder is deleted
install_uninstaller() {
  mkdir -p "$BASE/lib"
  cp "$ROOT/uninstall.sh"   "$BASE/uninstall.sh"
  cp "$ROOT/lib/common.sh"  "$BASE/lib/common.sh"
  chmod +x "$BASE/uninstall.sh"
}
