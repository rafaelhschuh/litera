#!/usr/bin/env bash
set -euo pipefail
# Keep screenshots even when a native UI assertion fails, before the emulator stops.
collect_screenshots() {
  mkdir -p build/device-screenshots
  adb pull /sdcard/Android/data/io.github.rafaelhschuh.litera.debug/files/test-screenshots/. build/device-screenshots/ || true
}
trap collect_screenshots EXIT
./gradlew --no-daemon connectedDebugAndroidTest
