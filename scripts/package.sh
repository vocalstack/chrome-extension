#!/usr/bin/env bash
# The loadable builds and their zips (CI's build workflow runs this too):
#
#   output/chrome, output/edge              load unpacked from these folders
#   output/vocalstack-chrome.zip, -edge.zip the same, zipped (folder inside)
#
#   VS_WEBSTORE=1 scripts/package.sh        the Chrome Web Store build instead:
#                                           output/store/chrome and
#                                           output/vocalstack-webstore.zip
#                                           (no `key` in the manifest)
#
# VS_VERSION sets the manifest version; unset, CI's scheme is used when
# the history is there: <package.json major.minor>.<commits on HEAD>.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${VS_VERSION:-}" ]; then
  base=$(node -p "require('./package.json').version.split('.').slice(0, 2).join('.')")
  VS_VERSION="$base.$(git rev-list --count HEAD)"
fi
export VS_VERSION
echo "[package] version $VS_VERSION"

zipdir() { # zipdir <dir> <zip> <name inside>
  local tmp; tmp=$(mktemp -d)
  cp -R "$1" "$tmp/$3"
  rm -f "$2"
  (cd "$tmp" && zip -qr -X "$OLDPWD/$2" "$3")
  rm -rf "$tmp"
}

if [ "${VS_WEBSTORE:-}" = 1 ]; then
  npx wxt build
  # The store wants manifest.json at the zip's root.
  rm -f output/vocalstack-webstore.zip
  (cd output/store/chrome && zip -qr -X ../../vocalstack-webstore.zip .)
  echo "[package] output/vocalstack-webstore.zip"
  exit 0
fi

npx wxt build
npx wxt build -b edge
zipdir output/chrome output/vocalstack-chrome.zip vocalstack-chrome
zipdir output/edge output/vocalstack-edge.zip vocalstack-edge
echo "[package] output/vocalstack-chrome.zip output/vocalstack-edge.zip"
