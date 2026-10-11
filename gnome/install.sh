#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════
#  Local Vaults — installer (Fedora/GNOME, Arch, any Linux)
#
#  ./install.sh                  install all three apps
#  ./install.sh manga-vault      install only the named app(s)
#  ./install.sh --runtime-only   just (re)install the shared Electron
#  ./install.sh --force-runtime  reinstall Electron even if present
#
#  Electron is downloaded ONCE and shared by all apps.
#  After that, nothing here ever needs the internet again.
# ═══════════════════════════════════════════════════════
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT/lib/common.sh"

FORCE=""; RUNTIME_ONLY=0; SELECTED=()
for arg in "$@"; do
  case "$arg" in
    --force-runtime) FORCE=force ;;
    --runtime-only)  RUNTIME_ONLY=1 ;;
    -h|--help)       sed -n '2,12p' "$0"; exit 0 ;;
    -*)              die "Unknown option: $arg" ;;
    *)               SELECTED+=("$arg") ;;
  esac
done
[ ${#SELECTED[@]} -eq 0 ] && SELECTED=("${APPS_ALL[@]}")

ensure_runtime "$FORCE"

if [ "$RUNTIME_ONLY" -eq 0 ]; then
  for app in "${SELECTED[@]}"; do install_app "$app"; done
  install_uninstaller
  refresh_desktop_db
fi

echo
ok "Done."
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not in your PATH — the apps still appear in the app grid; for the terminal commands add it to PATH." ;;
esac
echo "  • Open them from Activities (press Super, type: vault)"
echo "  • Or from a terminal:  ${SELECTED[*]}"
echo "  • Uninstall:           $BASE/uninstall.sh"
