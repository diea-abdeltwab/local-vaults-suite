#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  Music Vault — uninstaller
# ═══════════════════════════════════════════════════════
echo "→ Uninstalling Music Vault..."
rm -rf "$HOME/.local/share/music-vault"
rm -f  "$HOME/.local/bin/music-vault"
rm -f  "$HOME/.local/share/applications/music-vault.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "✓ Done."
