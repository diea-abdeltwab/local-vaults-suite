#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  Video Vault — uninstaller
# ═══════════════════════════════════════════════════════
set -e

INSTALL_DIR="$HOME/.local/share/video-vault"
BIN_DIR="$HOME/.local/bin"
DESK_DIR="$HOME/.local/share/applications"

echo "→ Uninstalling Video Vault..."

rm -rf "$INSTALL_DIR"
rm -f  "$BIN_DIR/video-vault"
rm -f  "$DESK_DIR/video-vault.desktop"

update-desktop-database "$DESK_DIR" 2>/dev/null || true

echo "✓ Video Vault uninstalled."
