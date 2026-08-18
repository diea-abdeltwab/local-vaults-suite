#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  Music Vault — installer for Arch Linux / omarchy
# ═══════════════════════════════════════════════════════
set -e

INSTALL_DIR="$HOME/.local/share/music-vault"
BIN_DIR="$HOME/.local/bin"
DESK_DIR="$HOME/.local/share/applications"

echo "→ Installing Music Vault..."

mkdir -p "$INSTALL_DIR"
cp -r "$(dirname "$0")/." "$INSTALL_DIR/"

if [ ! -d "$INSTALL_DIR/node_modules/electron" ]; then
  echo "→ Installing dependencies (first time only)..."
  cd "$INSTALL_DIR" && npm install --omit=dev
fi

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/music-vault" << 'SCRIPT'
#!/usr/bin/env bash
APP_DIR="$HOME/.local/share/music-vault"
cd "$APP_DIR"
export GDK_SCALE="${GDK_SCALE:-1}"
exec npx electron . "$@"
SCRIPT
chmod +x "$BIN_DIR/music-vault"

mkdir -p "$DESK_DIR"
cat > "$DESK_DIR/music-vault.desktop" << DESKTOP
[Desktop Entry]
Name=Music Vault
Comment=Local Music & Clips Player
Exec=$BIN_DIR/music-vault
Icon=$INSTALL_DIR/assets/icon.png
Type=Application
Categories=AudioVideo;Audio;Music;Player;
Keywords=music;clips;audio;player;catppuccin;
StartupWMClass=music-vault
DESKTOP

update-desktop-database "$DESK_DIR" 2>/dev/null || true

echo ""
echo "✓ Installed! You can now:"
echo "  • Run from terminal:  music-vault"
echo "  • Search in rofi/wofi: 'music' or 'vault'"
echo ""
echo "  To uninstall: $INSTALL_DIR/uninstall.sh"
