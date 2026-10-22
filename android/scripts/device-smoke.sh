#!/usr/bin/env bash
set -euo pipefail
# Keep screenshots even when a native UI assertion fails, before the emulator stops.
collect_screenshots() {
  local test_status=$?
  mkdir -p build/device-screenshots
  adb pull /sdcard/Android/data/io.github.rafaelhschuh.litera.debug/files/test-screenshots/. build/device-screenshots/ || true
  if [ "$test_status" -ne 0 ]; then
    adb exec-out screencap -p > build/device-screenshots/failure.png || true
  fi
}
trap collect_screenshots EXIT
./gradlew --no-daemon connectedDebugAndroidTest
