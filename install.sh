#!/usr/bin/env bash
# Install the linkparse module into Aurabot's modules directory.
set -euo pipefail

if [[ -n "${DSH_HOME:-}" ]]; then
  DEST="${DSH_HOME}/plugins-data/aurabot/modules"
else
  DEST="${HOME}/.dsh/plugins-data/aurabot/modules"
fi

TARGET="${DEST}/linkparse"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -rf "$TARGET"
  echo "Removed: $TARGET"
  exit 0
fi

mkdir -p "$DEST"

# Keep backups outside modules/: Aurabot loads every folder under it, and a
# "linkparse.bak-*" folder would fail with "module id must match folder name".
if [[ -f "${TARGET}/index.mjs" ]]; then
  BACKUP="${DEST}/.aurabot-backup/linkparse-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP"
  cp "$TARGET"/*.mjs "$BACKUP"/
  echo "Backed up previous copy to: $BACKUP"
fi

# Copy in place: the running Aurabot reloader watches this folder.
mkdir -p "$TARGET"
cp "$SOURCE/index.mjs" "$TARGET/index.mjs"
cp "$SOURCE/parse.mjs" "$TARGET/parse.mjs"

echo "Installed to: $TARGET"
echo "Aurabot will hot-reload the module within a few seconds."
