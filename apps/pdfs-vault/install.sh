#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  PDFs Vault — installer for Arch Linux / omarchy
# ═══════════════════════════════════════════════════════
set -e

INSTALL_DIR="$HOME/.local/share/pdfs-vault"
BIN_DIR="$HOME/.local/bin"
DESK_DIR="$HOME/.local/share/applications"

echo "→ Installing PDFs Vault..."

mkdir -p "$INSTALL_DIR"
cp -r "$(dirname "$0")/." "$INSTALL_DIR/"

if [ ! -d "$INSTALL_DIR/node_modules/electron" ]; then
  echo "→ Installing dependencies (first time only)..."
  cd "$INSTALL_DIR" && npm install --omit=dev
fi

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/pdfs-vault" << 'SCRIPT'
#!/usr/bin/env bash
APP_DIR="$HOME/.local/share/pdfs-vault"
cd "$APP_DIR"
# Set GTK window size hint for file picker on Wayland
export GDK_SCALE="${GDK_SCALE:-1}"
exec npx electron . "$@"
SCRIPT
chmod +x "$BIN_DIR/pdfs-vault"

mkdir -p "$DESK_DIR"
cat > "$DESK_DIR/pdfs-vault.desktop" << DESKTOP
[Desktop Entry]
Name=PDFs Vault
Comment=Local PDF Library Browser
Exec=$BIN_DIR/pdfs-vault
Icon=$INSTALL_DIR/assets/icon.png
Type=Application
Categories=Office;Viewer;
Keywords=pdf;library;documents;catppuccin;
StartupWMClass=pdfs-vault
DESKTOP

update-desktop-database "$DESK_DIR" 2>/dev/null || true

echo ""
echo "✓ Installed! You can now:"
echo "  • Run from terminal:  pdfs-vault"
echo "  • Search in rofi/wofi: 'pdfs' or 'vault'"
echo ""
echo "  To uninstall: $INSTALL_DIR/uninstall.sh"
