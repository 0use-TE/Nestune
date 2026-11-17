// Debug-only hidden integration probe. No network, user profile or desktop input.
addEventListener('DOMContentLoaded', async () => {
  const request = data => window.__TAURI_INTERNALS__.invoke('lyrics_command', { data });
  const check = (value, message) => { if (!value) throw Error(message); };
  const report = {};
  try {
    const initial = await request({ type: 'lyricsControlsProbe' });
    window.nestuneLyricsState(initial.state);
    check(initial.state.locked && initial.clickThrough && !initial.toolsClickThrough && !initial.visible, 'restored lock must pass text through and preserve tool input');
    report.restoredLockInteractive = true;
    await request({ type: 'lyricsMoveProbe' });
    await new Promise(resolve => setTimeout(resolve, 200));
    const fixed = await request({ type: 'lyricsControlsProbe' });
    check(fixed.x === initial.x && fixed.y === initial.y, 'native movement must not bypass restored lock');
    report.lockedNativeMovementDenied = true;
    const click = async id => {
      document.getElementById(id).click();
      // Commands complete asynchronously over the native IPC bridge.
      await new Promise(resolve => setTimeout(resolve, 250));
      return request({ type: 'lyricsControlsProbe' });
    };
    const unlocked = await click('lock');
    check(!unlocked.state.locked && !unlocked.clickThrough, 'unlock button failed');
    report.unlockButton = true;
    await request({ type: 'lyricsMoveProbe' });
    await new Promise(resolve => setTimeout(resolve, 200));
    const moved = await request({ type: 'lyricsControlsProbe' });
    check(moved.x !== unlocked.x || moved.y !== unlocked.y, 'unlocked lyrics must remain movable');
    report.unlockedNativeMovement = true;
    const locked = await click('lock');
    check(locked.state.locked && locked.clickThrough && !locked.toolsClickThrough, 'lock swallowed input');
    report.lockButton = true;
    try { await request({ type: 'lyricsDrag' }); throw Error('locked drag was accepted'); }
    catch (error) { check(String(error).includes('不支持'), 'locked drag must be rejected'); }
    report.lockedDragDenied = true;
    const panel = await click('panel');
    check(panel.state.panel !== initial.state.panel && panel.state.locked, 'locked background button failed');
    report.lockedBackgroundButton = true;
    const closed = await click('close');
    check(!closed.state.enabled && !closed.visible, 'locked close button failed');
    report.lockedCloseButton = true;
    report.passed = true;
  } catch (error) { report.error = String(error); report.passed = false; }
  document.title = 'NestuneControlsQA:' + JSON.stringify(report);
}, { once: true });
