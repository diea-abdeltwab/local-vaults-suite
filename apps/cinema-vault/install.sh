#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  Cinema Vault — installer for Arch Linux / omarchy
# ═══════════════════════════════════════════════════════
set -e

INSTALL_DIR="$HOME/.local/share/cinema-vault"
BIN_DIR="$HOME/.local/bin"
DESK_DIR="$HOME/.local/share/applications"

echo "→ Installing Cinema Vault..."

mkdir -p "$INSTALL_DIR"
cp -r "$(dirname "$0")/." "$INSTALL_DIR/"

if [ ! -d "$INSTALL_DIR/node_modules/electron" ]; then
  echo "→ Installing dependencies (first time only)..."
  cd "$INSTALL_DIR" && npm install --omit=dev
fi

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/cinema-vault" << 'SCRIPT'
#!/usr/bin/env bash
APP_DIR="$HOME/.local/share/cinema-vault"
cd "$APP_DIR"
export GDK_SCALE="${GDK_SCALE:-1}"
exec npx electron . "$@"
SCRIPT
chmod +x "$BIN_DIR/cinema-vault"

mkdir -p "$DESK_DIR"
cat > "$DESK_DIR/cinema-vault.desktop" << DESKTOP
[Desktop Entry]
Name=Cinema Vault
Comment=Local Movies, Series & Anime Player
Exec=$BIN_DIR/cinema-vault
Icon=$INSTALL_DIR/assets/icon.png
Type=Application
Categories=AudioVideo;Video;Player;
Keywords=movies;series;anime;player;catppuccin;
StartupWMClass=cinema-vault
DESKTOP

update-desktop-database "$DESK_DIR" 2>/dev/null || true

echo ""
echo "✓ Installed! You can now:"
echo "  • Run from terminal:  cinema-vault"
echo "  • Search in rofi/wofi: 'cinema' or 'vault'"
echo ""
echo "  To uninstall: $INSTALL_DIR/uninstall.sh"
