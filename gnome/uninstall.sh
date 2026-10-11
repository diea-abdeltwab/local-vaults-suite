#!/usr/bin/env bash
# Local Vaults — uninstaller
#
#   ./uninstall.sh                 remove all apps (keeps Electron + your progress/favorites)
#   ./uninstall.sh manga-vault     remove only the named app(s)
#   ./uninstall.sh --runtime       ALSO remove the shared Electron runtime
#   ./uninstall.sh --data          ALSO delete saved progress/favorites/settings
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$ROOT/lib/common.sh"

DO_RUNTIME=0; DO_DATA=0; SELECTED=()
for arg in "$@"; do
  case "$arg" in
    --runtime) DO_RUNTIME=1 ;;
    --data)    DO_DATA=1 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    -*)        die "Unknown option: $arg" ;;
    *)         SELECTED+=("$arg") ;;
  esac
done
[ ${#SELECTED[@]} -eq 0 ] && SELECTED=("${APPS_ALL[@]}")

for app in "${SELECTED[@]}"; do
  is_app "$app" || die "Unknown app: $app"
  rm -rf "$APPS_DIR/$app"
  rm -f  "$BIN_DIR/$app" "$DESK_DIR/$app.desktop"
  if [ "$DO_DATA" -eq 1 ]; then rm -rf "$CONFIG_HOME/$app"; fi
  ok "Removed $app"
done

if [ "$DO_RUNTIME" -eq 1 ]; then
  rm -rf "$RUNTIME"; ok "Removed shared Electron runtime"
fi
update-desktop-database "$DESK_DIR" >/dev/null 2>&1 || true

# nothing left? tidy the base folder (and this very script)
if [ -z "$(ls -A "$APPS_DIR" 2>/dev/null)" ] && [ ! -d "$RUNTIME" ]; then
  rm -rf "$BASE"
fi
if [ "$DO_DATA" -eq 0 ]; then
  echo "  (your progress/favorites in $CONFIG_HOME/<app>/ were kept; add --data to delete them)"
fi
