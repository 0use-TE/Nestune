# Android native checks

`Probe.java` covers the media/download bridge and keyboard layout. `LyricsProbe.java`
covers the real system overlay over the launcher, its independent clock, pause,
seek, translation, pointer drag, lock/unlock, rotation, close events, and child-frame
denial. Neither probe signs in or changes server playlists/messages.

Use a dedicated emulator and temporary test signatures. `run.sh` builds the probe
APK and signs test copies with an ephemeral key; never substitute a production
signing key in CI. It runs the original media probe by default.

After installing the temporary target/probe APKs on that emulator, run the overlay
checks separately (replace the serial if needed):

```sh
adb -s emulator-5580 shell appops set net.ouse.nestune SYSTEM_ALERT_WINDOW deny
adb -s emulator-5580 shell am instrument -w -e mode permission net.ouse.nestune.probe/net.ouse.nestune.probe.LyricsProbe
adb -s emulator-5580 shell appops set net.ouse.nestune SYSTEM_ALERT_WINDOW allow
adb -s emulator-5580 shell am instrument -w net.ouse.nestune.probe/net.ouse.nestune.probe.LyricsProbe
```

Expected markers are `NESTUNE_LYRICS_PERMISSION_PASS` and
`NESTUNE_LYRICS_RUNTIME_PASS`. Permission navigation checks both the ActivityMonitor
and the actual foreground settings package because Android's SPA settings activity
may not be intercepted by the monitor. These commands change only the selected test
device; never run them on a user's installed production app.
