#!/usr/bin/env bash
INSTALL_DIR="$HOME/.local/share/manga-vault"
rm -rf "$INSTALL_DIR"
rm -f  "$HOME/.local/bin/manga-vault"
rm -f  "$HOME/.local/share/applications/manga-vault.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "✓ Manga Vault uninstalled."
