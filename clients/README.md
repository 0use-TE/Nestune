# Nestune installable clients

Both clients open `https://music.0use.net/` and keep account and music data on the NAS. Web changes use the existing PWA release flow; native wrapper changes require a new package. Windows V1.0.0 is in `../releases/1.0.0/` (git-ignored). Android packaging is currently stopped at the user's request.

## Windows x64

`windows/` is a small .NET Framework 4.8 WPF application using Microsoft WebView2. The V1.0.0 release uses the framework supplied by Windows 10 1903+ / Windows 11 instead of bundling the .NET 10 runtime. The installer checks for Framework 4.8. The per-user installer adds Start menu and desktop shortcuts and an uninstaller. It includes a signed Microsoft bootstrapper that installs WebView2 only if missing; that step needs internet. Login cookies live in `%LOCALAPPDATA%/Nestune/WebView2` and are not deleted during an upgrade. The application icon and WPF window icon both use a multi-resolution ICO.

Run `./build-windows.ps1` with the Inno Setup compiler available. Compiler and bootstrapper are build tools under `../work/packaging-tools/`; the Microsoft bootstrapper must have a valid Authenticode signature. Native client has no host objects or message bridge; navigation stays on the music origin and user-clicked external HTTPS links use the system browser. No microphone, camera or location permissions are granted. `Nestune.exe --check` performs a hidden load check and writes its report to the current user's temp directory.

The installer has no public Windows code-signing certificate; Windows may show an unknown-publisher notice. It is not an offline music client.

## Android

`android/` builds a release APK using Android Browser Helper (Trusted Web Activity). Requires Android 7+ and a compatible TWA browser, such as Chrome. Without a TWA browser the helper can use a browser tab. No advertising, analytics or push delegation is configured.

Run `./build-android.ps1` with JDK 21, Android SDK 36 and Gradle 8.13. It creates and reuses a private release key under `%USERPROFILE%/.nestune/signing/`. **Back up that entire private directory securely. Never distribute it with the APK or replace its key: future upgrades must use the same package ID and signing key.** The credentials file contains the keystore password and is restricted to the current Windows account and SYSTEM.

The script writes the public certificate fingerprint to `../web/public/.well-known/assetlinks.json`. Deploy that public JSON to the same HTTPS origin before distributing the APK. Check the APK using Android SDK `apksigner verify --print-certs` and compare with the live asset links. The package ID is `net.ouse.nestune`; bump `versionCode` and `versionName` before the next native release.
