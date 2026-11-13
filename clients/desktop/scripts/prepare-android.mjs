import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const android = path.join(root, 'src-tauri/gen/android');
const icons = path.join(android, 'nestune-icons');
const cli = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js');
const source = path.resolve(root, '../../web/public/pwa/icon-512.png');
const result = spawnSync(process.execPath, [cli, 'icon', source, '--output', icons], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status !== 0) throw new Error('Unable to generate application icons');
cpSync(path.join(icons, 'android'), path.join(android, 'app/src/main/res'), { recursive: true });

// The production client uses HTTPS only, including inside Android's webview.
const manifestPath = path.join(android, 'app/src/main/AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');
if (!manifest.includes('android:usesCleartextTraffic="')) {
  manifest = manifest.replace('<application', '<application android:usesCleartextTraffic="false"');
} else {
  manifest = manifest.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="false"');
}
manifest = manifest.replace('</manifest>', '  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />\n  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />\n</manifest>');
manifest = manifest.replace('</application>', '  <service android:name=".NativeMediaService" android:exported="false" android:foregroundServiceType="mediaPlayback" />\n</application>');
writeFileSync(manifestPath, manifest);
cpSync(path.join(root, 'android/MainActivity.kt'), path.join(android, 'app/src/main/java/net/ouse/nestune/MainActivity.kt'));
cpSync(path.join(root, 'android/NativeMediaService.kt'), path.join(android, 'app/src/main/java/net/ouse/nestune/NativeMediaService.kt'));

// The release APK stays unsigned in CI. The private release key remains on the owner's PC.
const gradlePath = path.join(android, 'app/build.gradle.kts');
if (!existsSync(gradlePath)) throw new Error('Android project was not initialized');
const gradle = readFileSync(gradlePath, 'utf8');
if (!gradle.includes('applicationId = "net.ouse.nestune"')) {
  throw new Error('Unexpected Android application ID');
}
writeFileSync(gradlePath, gradle.replace('dependencies {', 'dependencies {\n    implementation("androidx.webkit:webkit:1.14.0")'));
console.log('Android project ready: net.ouse.nestune, production HTTPS origin, Nestune icons.');
