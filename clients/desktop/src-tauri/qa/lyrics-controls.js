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
    for (const edge of ['top', 'bottom']) {
      await request({ type: 'lyricsMoveProbe', edge });
      await new Promise(resolve => setTimeout(resolve, 250));
      const placed = await request({ type: 'lyricsControlsProbe' });
      check(placed.toolsAligned && placed.toolsBelow === (edge === 'top'), 'tools did not flip at the ' + edge);
      check(placed.toolsSizeCorrect && placed.toolsWidth >= 255, 'native tools size: ' + JSON.stringify(placed));
    }
    report.toolbarPlacementBothHalves = true;
    const measure = () => ({
      width: innerWidth,
      height: innerHeight,
      font: parseFloat(getComputedStyle(document.getElementById('line')).fontSize),
    });
    const original = measure();
    await request({ type: 'lyricsResize', direction: 'larger' });
    await new Promise(resolve => setTimeout(resolve, 300));
    const larger = measure();
    check(larger.width > original.width && larger.height > original.height && larger.font > original.font,
      'window and lyric did not enlarge: ' + JSON.stringify({ original, larger }));
    await request({ type: 'lyricsResize', direction: 'smaller' });
    await new Promise(resolve => setTimeout(resolve, 300));
    const smaller = measure();
    check(smaller.width < larger.width && smaller.height < larger.height && smaller.font < larger.font,
      'window and lyric did not shrink');
    report.nativeResize = { original, larger, smaller };
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
