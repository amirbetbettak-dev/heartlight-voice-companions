#!/usr/bin/env bash
# Prepares the generated Capacitor Android project (android/) for building the Hamdam APK:
# app icon + launch screen, and the microphone permissions voice chat needs.
# Used by the GitHub Actions workflow; run after `npx cap add android` / `npx cap sync android`.
set -euo pipefail
cd "$(dirname "$0")/.."

RES=android/app/src/main/res
MANIFEST=android/app/src/main/AndroidManifest.xml

# Replace Capacitor's default icon and splash images with Hamdam's.
rm -f "$RES"/mipmap-anydpi-v26/ic_launcher.xml "$RES"/mipmap-anydpi-v26/ic_launcher_round.xml
find "$RES" -name 'splash.png' -delete
cp -R android-overrides/res/. "$RES"/

# Microphone for voice chat.
for PERM in RECORD_AUDIO MODIFY_AUDIO_SETTINGS; do
  grep -q "android.permission.$PERM" "$MANIFEST" ||
    sed -i "s#</manifest>#    <uses-permission android:name=\"android.permission.$PERM\" />\n</manifest>#" "$MANIFEST"
done

# Android 11+ only lets the app find the phone's speech recognizer when it is declared here.
grep -q "android.speech.RecognitionService" "$MANIFEST" ||
  sed -i "s#</manifest>#    <queries>\n        <intent>\n            <action android:name=\"android.speech.RecognitionService\" />\n        </intent>\n    </queries>\n</manifest>#" "$MANIFEST"

# Each build gets a higher version number (GitHub run number), so Android accepts it as an update.
if [ -n "${APP_VERSION_CODE:-}" ]; then
  sed -i -E "s/versionCode [0-9]+/versionCode $APP_VERSION_CODE/; s/versionName \"[^\"]*\"/versionName \"1.$APP_VERSION_CODE\"/" android/app/build.gradle
fi

echo "Android project prepared."
