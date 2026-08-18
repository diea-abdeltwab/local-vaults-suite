#!/usr/bin/env bash
set -e
APP="image-vault"
SRC="$(cd "$(dirname "$0")"; pwd)"
DEST="$HOME/.local/share/$APP"
BIN="$HOME/.local/bin/$APP"
DESK="$HOME/.local/share/applications/$APP.desktop"

echo "→ Installing Image Vault..."

# clean old install
[ -d "$DEST" ] && rm -rf "$DEST"

# copy everything
mkdir -p "$DEST"
cp -r "$SRC/src"      "$DEST/"
cp -r "$SRC/assets"   "$DEST/"
cp    "$SRC/package.json" "$DEST/"
cp    "$SRC/package-lock.json" "$DEST/" 2>/dev/null || true
cp    "$SRC/uninstall.sh" "$DEST/" && chmod +x "$DEST/uninstall.sh"

# dependencies
echo "→ Installing dependencies..."
cd "$DEST" && npm install --omit=dev 2>&1 | grep -E "^added|error" || true

# launcher
mkdir -p "$(dirname "$BIN")"
cat > "$BIN" << SCRIPT
#!/usr/bin/env bash
exec npx electron "\$HOME/.local/share/$APP" "\$@"
SCRIPT
chmod +x "$BIN"

# .desktop
mkdir -p "$(dirname "$DESK")"
cat > "$DESK" << DESKTOP
[Desktop Entry]
Name=Image Vault
Comment=Local image vault — Catppuccin Mocha
Exec=$BIN
Icon=$DEST/assets/icon.png
Type=Application
Categories=Graphics;Viewer;
Keywords=gallery;images;photos;vault;
StartupWMClass=$APP
DESKTOP
update-desktop-database "$(dirname "$DESK")" 2>/dev/null || true

echo ""
echo "✓ Done!"
echo "  run:    image-vault"
echo "  remove: $DEST/uninstall.sh"
