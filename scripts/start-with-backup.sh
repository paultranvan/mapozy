#!/usr/bin/env bash
set -euo pipefail

PKG="com.paul.mapozy"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_ARG="${1:-}"

if ! command -v emulator >/dev/null; then
  echo "'emulator' not in PATH. Add \$ANDROID_HOME/emulator to PATH." >&2
  exit 1
fi

if ! adb devices | awk 'NR>1 && $2=="device"' | grep -q "^emulator-"; then
  AVD="$(emulator -list-avds | head -n1)"
  if [[ -z "$AVD" ]]; then
    echo "No AVD found. Create one in Android Studio first." >&2
    exit 1
  fi
  echo "Starting emulator: $AVD"
  nohup emulator -avd "$AVD" >/dev/null 2>&1 &
fi

echo "Waiting for device to boot..."
adb wait-for-device
until [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
  sleep 2
done

echo "Building and installing app..."
( cd "$ROOT" && npm run android )

echo "Loading backup..."
if [[ -z "$BACKUP_ARG" ]]; then
  "$ROOT/scripts/load-backup.sh"
elif [[ -f "$BACKUP_ARG" ]]; then
  "$ROOT/scripts/load-backup.sh" "$BACKUP_ARG"
else
  "$ROOT/scripts/load-backup.sh" "$ROOT/backups/$BACKUP_ARG"
fi

echo "Launching app..."
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
echo "Done."
