#!/usr/bin/env bash
INSTALL_DIR="$HOME/.local/share/code-vault"
rm -rf "$INSTALL_DIR"
rm -f  "$HOME/.local/bin/code-vault"
rm -f  "$HOME/.local/share/applications/code-vault.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "✓ Code Vault uninstalled."
