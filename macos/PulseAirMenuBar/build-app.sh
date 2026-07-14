#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
PRODUCT="Pulse Air.app"
DIST="$ROOT/dist"

cd "$ROOT"
swift build -c release --product PulseAirMenuBar
BIN_DIR="$(swift build -c release --show-bin-path)"

mkdir -p "$DIST/$PRODUCT/Contents/MacOS"
cp "$ROOT/Resources/Info.plist" "$DIST/$PRODUCT/Contents/Info.plist"
cp "$BIN_DIR/PulseAirMenuBar" "$DIST/$PRODUCT/Contents/MacOS/PulseAirMenuBar"
codesign --force --deep --sign - "$DIST/$PRODUCT"

echo "$DIST/$PRODUCT"
