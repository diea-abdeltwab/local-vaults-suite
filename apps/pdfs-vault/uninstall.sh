#!/usr/bin/env bash
INSTALL_DIR="$HOME/.local/share/pdfs-vault"
rm -rf "$INSTALL_DIR"
rm -f  "$HOME/.local/bin/pdfs-vault"
rm -f  "$HOME/.local/share/applications/pdfs-vault.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "✓ PDFs Vault uninstalled."
