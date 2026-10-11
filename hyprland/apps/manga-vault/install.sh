#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  Manga Vault — installer for Arch Linux / omarchy
# ═══════════════════════════════════════════════════════
set -e

INSTALL_DIR="$HOME/.local/share/manga-vault"
BIN_DIR="$HOME/.local/bin"
DESK_DIR="$HOME/.local/share/applications"

echo "→ Installing Manga Vault..."

mkdir -p "$INSTALL_DIR"
cp -r "$(dirname "$0")/." "$INSTALL_DIR/"

if [ ! -d "$INSTALL_DIR/node_modules/electron" ]; then
  echo "→ Installing dependencies (first time only)..."
  cd "$INSTALL_DIR" && npm install --omit=dev
fi

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/manga-vault" << 'SCRIPT'
#!/usr/bin/env bash
APP_DIR="$HOME/.local/share/manga-vault"
cd "$APP_DIR"
# Set GTK window size hint for file picker on Wayland
export GDK_SCALE="${GDK_SCALE:-1}"
exec npx electron . "$@"
SCRIPT
chmod +x "$BIN_DIR/manga-vault"

mkdir -p "$DESK_DIR"
cat > "$DESK_DIR/manga-vault.desktop" << DESKTOP
[Desktop Entry]
Name=Manga Vault
Comment=Local Manga & Manhwa Reader
Exec=$BIN_DIR/manga-vault
Icon=$INSTALL_DIR/assets/icon.png
Type=Application
Categories=Graphics;Viewer;
Keywords=manga;manhwa;reader;catppuccin;
StartupWMClass=manga-vault
DESKTOP

update-desktop-database "$DESK_DIR" 2>/dev/null || true

echo ""
echo "✓ Installed! You can now:"
echo "  • Run from terminal:  manga-vault"
echo "  • Search in rofi/wofi: 'manga' or 'vault'"
echo ""
echo "  To uninstall: $INSTALL_DIR/uninstall.sh"
