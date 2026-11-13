#!/usr/bin/env bash
set -euo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
output="$RUNNER_TEMP/nestune-native-check"
mkdir -p "$output/classes" "$output/dex"
tools="$ANDROID_HOME/build-tools/35.0.0"
platform="$ANDROID_HOME/platforms/android-35/android.jar"
javac -source 8 -target 8 -classpath "$platform" -d "$output/classes" "$source_dir/Probe.java"
"$tools/d8" --lib "$platform" --output "$output/dex" "$output/classes/net/ouse/nestune/probe/"*.class
"$tools/aapt" package -f -M "$source_dir/AndroidManifest.xml" -I "$platform" -F "$output/probe.apk"
(cd "$output/dex" && zip -j "$output/probe.apk" classes.dex)
keytool -genkeypair -keystore "$output/test.jks" -storepass ci-probe-only -keypass ci-probe-only -alias probe -keyalg RSA -dname CN=Ephemeral-CI -validity 2 -noprompt
# Both APKs use an ephemeral test-only key. Production signing remains local.
apk=$(find "$GITHUB_WORKSPACE/unsigned" -name '*.apk' -print -quit)
"$tools/apksigner" sign --ks "$output/test.jks" --ks-pass pass:ci-probe-only --out "$output/app.apk" "$apk"
"$tools/apksigner" sign --ks "$output/test.jks" --ks-pass pass:ci-probe-only "$output/probe.apk"
adb install "$output/app.apk"
adb install "$output/probe.apk"
adb shell am instrument -w net.ouse.nestune.probe/net.ouse.nestune.probe.Probe | tee "$GITHUB_WORKSPACE/native-check.txt"
grep -q NESTUNE_ANDROID_PASS "$GITHUB_WORKSPACE/native-check.txt"
