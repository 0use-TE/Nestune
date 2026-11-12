# Nestune installable clients

The clients open `https://music.0use.net/` and keep account and music data on the NAS. Web changes use the existing PWA release flow; native wrapper changes require a new package. Android packaging is currently stopped at the user's request.

## Windows x64 — Tauri V1.0.0

`desktop/` is the Tauri 2 client. Build on Windows with the x64 MSVC Rust toolchain, Microsoft C++ Build Tools and Node.js installed:

```powershell
./clients/build-tauri-windows.ps1
```

The script uses the npm and Cargo lockfiles and writes these files to `releases/1.0.0-tauri/` (git-ignored):

- `Nestune-1.0.0-Windows-x64-Tauri-Setup.exe`: per-user NSIS installer with Simplified Chinese and English, shortcuts and uninstaller.
- `Nestune-1.0.0-Windows-x64-Tauri.exe`: portable executable; requires the Microsoft Edge WebView2 runtime.
- `SHA256SUMS.txt`: SHA-256 checksums for both executables.

The installer downloads WebView2 only when it is missing. The browser engine and the NAS server are not bundled. The app has a native window and application icon, remembers the login in its own persistent WebView2 profile, and focuses the existing window when opened again. The older .NET client's login profile is not migrated; sign in once in the Tauri client. Web updates appear without rebuilding the client. An internet connection is required.

The webview stays on the music HTTPS origin; external HTTPS links open in the system browser. Browser file access still requires the user's permission. No Tauri command capabilities are granted to remote web content. `--smoke-test` starts a hidden window with an isolated temporary browser profile for runtime checks; it runs until explicitly closed. The release is not signed with a public Windows code-signing certificate.

For development, run `npm ci` and `npm run dev` from `clients/desktop/`. The Rust shell is separate from the NAS-backed Next.js app; the `frontendDist` URL in `src-tauri/tauri.conf.json` and the trusted origin in `src/main.rs` must agree when changing domains.

## Linux x64 and macOS universal — Tauri V1.0.0

The [desktop workflow](https://github.com/0use-TE/Nestune/actions/workflows/desktop.yml) builds on native Ubuntu 22.04 and macOS 15 runners. It runs when desktop sources change on `main`, and can also be started with **Run workflow**, selecting both platforms or just Linux/macOS. Download the packages from a successful job's **Artifacts** section. Artifacts are retained for 30 days; these are build artifacts rather than a public GitHub Release.

| Platform | Packages | Checks |
| --- | --- | --- |
| Linux x86-64 | AppImage and deb | Debian package metadata, linked libraries and a bounded GTK/WebKit startup under Xvfb |
| macOS 11+ | Universal DMG and zipped app | Intel `x86_64` and Apple Silicon `arm64` slices, bundle metadata and DMG integrity |

Each artifact includes `SHA256SUMS.txt`. These checks do not replace real-device music playback testing. The macOS build is not Developer ID signed or Apple notarized, so Gatekeeper may require allowing the app in System Settings before it can run.

On Arch Linux, use the AppImage. Enable its executable permission first, for example `chmod +x Nestune-1.0.0-Linux-x64.AppImage`. AppImage FUSE mounting requires the distribution's FUSE 2 compatibility library (`fuse2` on Arch); `--appimage-extract-and-run` is an alternative. The AppImage includes GStreamer media libraries for audio playback, which makes it larger than the Windows installer. The deb package declares additional GStreamer dependencies. The desktop uses the platform webview; features such as browser access to a local music folder depend on that webview's support.

To build on Linux, install Tauri's [Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux), GStreamer's base/good plugins and libav plugin. From `clients/desktop/`, run:

```sh
npm ci
npm run build:linux
```

To build on a Mac with Xcode command line tools, Rust and Node.js installed:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run build:macos
```

The platform-specific `tauri.linux.conf.json` and `tauri.macos.conf.json` configure packaging without changing the Windows NSIS build.

## Windows x64 — previous .NET client

`windows/` is a small .NET Framework 4.8 WPF application using Microsoft WebView2. The V1.0.0 release uses the framework supplied by Windows 10 1903+ / Windows 11 instead of bundling the .NET 10 runtime. The installer checks for Framework 4.8. The per-user installer adds Start menu and desktop shortcuts and an uninstaller. It includes a signed Microsoft bootstrapper that installs WebView2 only if missing; that step needs internet. Login cookies live in `%LOCALAPPDATA%/Nestune/WebView2` and are not deleted during an upgrade. The application icon and WPF window icon both use a multi-resolution ICO.

Run `./build-windows.ps1` with the Inno Setup compiler available. Compiler and bootstrapper are build tools under `../work/packaging-tools/`; the Microsoft bootstrapper must have a valid Authenticode signature. Native client has no host objects or message bridge; navigation stays on the music origin and user-clicked external HTTPS links use the system browser. No microphone, camera or location permissions are granted. `Nestune.exe --check` performs a hidden load check and writes its report to the current user's temp directory.

The installer has no public Windows code-signing certificate; Windows may show an unknown-publisher notice. It is not an offline music client.

## Android

`android/` builds a release APK using Android Browser Helper (Trusted Web Activity). Requires Android 7+ and a compatible TWA browser, such as Chrome. Without a TWA browser the helper can use a browser tab. No advertising, analytics or push delegation is configured.

Run `./build-android.ps1` with JDK 21, Android SDK 36 and Gradle 8.13. It creates and reuses a private release key under `%USERPROFILE%/.nestune/signing/`. **Back up that entire private directory securely. Never distribute it with the APK or replace its key: future upgrades must use the same package ID and signing key.** The credentials file contains the keystore password and is restricted to the current Windows account and SYSTEM.

The script writes the public certificate fingerprint to `../web/public/.well-known/assetlinks.json`. Deploy that public JSON to the same HTTPS origin before distributing the APK. Check the APK using Android SDK `apksigner verify --print-certs` and compare with the live asset links. The package ID is `net.ouse.nestune`; bump `versionCode` and `versionName` before the next native release.
