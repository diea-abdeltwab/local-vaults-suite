#!/usr/bin/env bash
echo "→ Uninstalling Cinema Vault..."
rm -rf "$HOME/.local/share/cinema-vault"
rm -f  "$HOME/.local/bin/cinema-vault"
rm -f  "$HOME/.local/share/applications/cinema-vault.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "✓ Done."
