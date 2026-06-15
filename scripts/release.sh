#!/usr/bin/env bash
#
# Cut a release: bump app.json (version + versionCode), commit, tag, push.
# Pushing the tag triggers the "Distribute to Firebase App Distribution" CI
# workflow, which builds a signed APK and ships it to the testers group.
#
# Usage:
#   scripts/release.sh                 # patch bump (0.3.0 -> 0.3.1)
#   scripts/release.sh minor           # 0.3.0 -> 0.4.0
#   scripts/release.sh major           # 0.3.0 -> 1.0.0
#   scripts/release.sh 0.5.2           # explicit version
#   scripts/release.sh patch -y        # skip the confirmation prompt
#
# Or via npm:  npm run release -- minor
#
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH=main

# --- parse args (positional version/bump + optional -y) ---
VERSION_ARG=""
ASSUME_YES=0
for a in "$@"; do
  case "$a" in
    -y|--yes) ASSUME_YES=1 ;;
    -*) echo "✖ Unknown flag: $a" >&2; exit 1 ;;
    *) VERSION_ARG="$a" ;;
  esac
done
VERSION_ARG="${VERSION_ARG:-patch}"

# --- preflight ---
if [[ -n "$(git status --porcelain)" ]]; then
  echo "✖ Working tree not clean — commit or stash first." >&2
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  echo "✖ On '$CURRENT_BRANCH', releases must be cut from '$BRANCH'." >&2
  exit 1
fi

git fetch --quiet origin "$BRANCH"
if [[ -n "$(git rev-list "HEAD..origin/$BRANCH")" ]]; then
  echo "✖ Local $BRANCH is behind origin/$BRANCH — pull first." >&2
  exit 1
fi

# --- compute next version + versionCode ---
CUR_VERSION=$(node -p "require('./app.json').expo.version")
CUR_CODE=$(node -p "require('./app.json').expo.android.versionCode")

case "$VERSION_ARG" in
  patch|minor|major)
    NEW_VERSION=$(node -e '
      const [maj, min, pat] = process.argv[1].split(".").map(Number);
      const t = process.argv[2];
      const v = t === "major" ? [maj + 1, 0, 0]
              : t === "minor" ? [maj, min + 1, 0]
              : [maj, min, pat + 1];
      console.log(v.join("."));
    ' "$CUR_VERSION" "$VERSION_ARG")
    ;;
  *)
    if [[ ! "$VERSION_ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "✖ '$VERSION_ARG' is not 'patch', 'minor', 'major', or x.y.z" >&2
      exit 1
    fi
    NEW_VERSION="$VERSION_ARG"
    ;;
esac

NEW_CODE=$((CUR_CODE + 1))
TAG="v$NEW_VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "✖ Tag $TAG already exists." >&2
  exit 1
fi

echo "Release plan:"
echo "  version:     $CUR_VERSION  ->  $NEW_VERSION"
echo "  versionCode: $CUR_CODE  ->  $NEW_CODE"
echo "  tag:         $TAG  (pushed to origin/$BRANCH, triggers CI distribute)"
echo

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Proceed? [y/N] " reply < /dev/tty || reply=""
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

# --- apply edits to app.json (regex replace preserves formatting) ---
node -e '
  const fs = require("fs");
  const nv = process.argv[1], nc = process.argv[2];
  let s = fs.readFileSync("app.json", "utf8");
  s = s.replace(/("version":\s*")[^"]+(")/, (m, a, b) => a + nv + b);
  s = s.replace(/("versionCode":\s*)(\d+)/, (m, a) => a + nc);
  fs.writeFileSync("app.json", s);
' "$NEW_VERSION" "$NEW_CODE"

git add app.json
git commit -q -m "release: $NEW_VERSION"
git tag "$TAG"
git push --quiet origin "$BRANCH"
git push --quiet origin "$TAG"

echo "✓ Pushed $TAG — CI is building and distributing to Firebase App Distribution."
echo "  Track it:  gh run list --workflow distribute.yml -L1"
