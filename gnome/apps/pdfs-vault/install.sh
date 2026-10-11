#!/usr/bin/env bash
# Installs just pdfs-vault (the shared installer lives at the repo root).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/install.sh" pdfs-vault "$@"
