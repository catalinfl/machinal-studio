#!/bin/sh
set -eu
exec /opt/chrome/chrome-linux64/chrome \
  --enable-unsafe-webgpu \
  --enable-unsafe-swiftshader \
  --enable-blink-features=CanvasDrawElement \
  --enable-experimental-web-platform-features \
  "$@"
