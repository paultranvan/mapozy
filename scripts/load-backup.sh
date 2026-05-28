#!/usr/bin/env bash
set -euo pipefail

PKG="com.paul.mapozy"
BACKUPS_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"

FILE="${1:-}"
if [[ -z "$FILE" ]]; then
  FILE="$(ls -1t "$BACKUPS_DIR"/mapozy-export-*.db 2>/dev/null | head -n1 || true)"
  if [[ -z "$FILE" ]]; then
    echo "No backup found in $BACKUPS_DIR (expected mapozy-export-*.db)" >&2
    exit 1
  fi
fi

if [[ ! -f "$FILE" ]]; then
  echo "Not a file: $FILE" >&2
  exit 1
fi

if ! adb shell pm list packages | grep -q "package:$PKG$"; then
  echo "$PKG is not installed on the connected device. Run 'npm run android' first." >&2
  exit 1
fi

echo "Loading $(basename "$FILE") into $PKG..."

adb shell am force-stop "$PKG"
adb push "$FILE" /data/local/tmp/mapozy.db >/dev/null
adb shell "run-as $PKG mkdir -p files/SQLite"
adb shell "cat /data/local/tmp/mapozy.db | run-as $PKG sh -c 'cat > files/SQLite/mapozy.db'"
adb shell "run-as $PKG rm -f files/SQLite/mapozy.db-wal files/SQLite/mapozy.db-shm"
adb shell rm /data/local/tmp/mapozy.db

echo "Done. Launch the app to use the loaded DB."
