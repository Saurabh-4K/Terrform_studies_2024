#!/usr/bin/env bash
# Installs the APK on an emulator with Wi-Fi and mobile data off, opens it and
# checks that the app screen appears: everything works offline. The internet
# permission is there only for the optional Ask AI (off by default); the unit
# tests check that Ask AI is the app's only network call.
set -euo pipefail
APP=com.salaryrunway.app

adb install -r SalaryRunway.apk
echo "--- Permissions the app asks for"
adb shell dumpsys package "$APP" | sed -n '/requested permissions:/,/install permissions:/p'

# Like airplane mode: no Wi-Fi, no mobile data.
adb shell svc wifi disable || true
adb shell svc data disable || true

adb logcat -c
adb shell am start -W -n "$APP/.MainActivity"
sleep 25
adb exec-out screencap -p > device-screen.png || true

echo "--- WebView and app log"
adb logcat -d | grep -iE "Capacitor|chromium|Hisab Se" | tail -60 || true

adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
adb pull /sdcard/ui.xml ui.xml >/dev/null 2>&1 || true
echo "--- Text on screen"
grep -o 'text="[^"]\+"' ui.xml 2>/dev/null | head -40 || true

if adb logcat -d | grep -q "Hisab Se: ready" || grep -q "Hisab Se" ui.xml 2>/dev/null; then
  echo "OK: the app screen loaded without internet"
else
  echo "FAIL: the app screen did not load"
  exit 1
fi
