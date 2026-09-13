#!/usr/bin/env bash
# One-time setup for the browser tests (pnpm test:browser) on Ubuntu or WSL, without root.
#
# Playwright's Chromium needs three shared libraries that a minimal Ubuntu lacks:
# libnspr4, libnss3 and libasound2t64. With root, the clean fix is:
#
#   sudo apt-get install -y libnspr4 libnss3 libasound2t64
#
# Without root, this downloads those packages and unpacks them into a user cache. The
# Playwright config adds that directory to LD_LIBRARY_PATH. Nothing system-wide changes.
set -euo pipefail

ROOT="${LM_BROWSER_LIBS_ROOT:-$HOME/.cache/lost-minutes/browser-libs}"
TARGET="$ROOT/root/usr/lib/x86_64-linux-gnu"

if [ -e "$TARGET/libnss3.so" ] && [ -e "$TARGET/libnspr4.so" ] && [ -e "$TARGET/libasound.so.2" ]; then
  echo "browser libraries already present in $TARGET"
else
  mkdir -p "$ROOT/debs"
  cd "$ROOT/debs"
  # Package names moved with Ubuntu's 64-bit time transition; accept either spelling.
  apt-get download libnspr4 libnss3 libasound2t64 2>/dev/null \
    || apt-get download libnspr4 libnss3 libasound2
  for deb in ./*.deb; do dpkg-deb -x "$deb" "$ROOT/root"; done
  echo "unpacked into $TARGET"
fi

CHROME=$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1 || true)
if [ -z "$CHROME" ]; then
  echo "no cached Playwright Chromium; run: pnpm exec playwright install chromium"
  exit 1
fi
if LD_LIBRARY_PATH="$TARGET" ldd "$CHROME" | grep -q "not found"; then
  echo "still missing for $CHROME:"
  LD_LIBRARY_PATH="$TARGET" ldd "$CHROME" | grep "not found"
  exit 1
fi
echo "ready: $(LD_LIBRARY_PATH="$TARGET" "$CHROME" --version)"
