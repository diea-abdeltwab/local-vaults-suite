#!/usr/bin/env bash
APP="image-vault"
echo "→ Removing Image Vault..."
rm -rf "$HOME/.local/share/$APP"
rm -f  "$HOME/.local/bin/$APP"
rm -f  "$HOME/.local/share/applications/$APP.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "✓ Done."
