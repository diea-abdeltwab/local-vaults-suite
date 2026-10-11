#!/usr/bin/env bash
# Installs just image-vault (the shared installer lives at the repo root).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/install.sh" image-vault "$@"
