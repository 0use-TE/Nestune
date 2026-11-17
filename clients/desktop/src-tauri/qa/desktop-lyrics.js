// Debug-only integration probe. It never signs in, plays audio or changes server data.
addEventListener('DOMContentLoaded', () => setTimeout(async () => {
  const request = data => window.NestuneDesktop.request(data);
  const report = {};
  try {
    report.info = await request({ type: 'lyricsInfo' });
    report.open = await request({ type: 'lyricsEnable', enabled: true });
    await request({ type: 'lyricsData', id: 'native-qa', title: 'Nestune · 桌面歌词', plainText: '', lines: [
      { t: 0, text: '让音乐留在眼前', tr: 'Keep the music close' },
      { t: 2, text: '把歌词轻轻放在桌面', tr: 'Lyrics that stay with you' }
    ] });
    await request({ type: 'lyricsMedia', id: 'native-qa', position: 0, playing: true });
    try { await request({ type: 'lyricsDrag' }); report.mainDragDenied = false; } catch { report.mainDragDenied = true; }
    report.lock = await request({ type: 'lyricsLock', locked: true });
    report.unlock = await request({ type: 'lyricsLock', locked: false });
    await new Promise(resolve => setTimeout(resolve, 3500));
    await request({ type: 'lyricsProbe' });
    document.title = 'NestuneQA:' + JSON.stringify(report);
    setTimeout(() => request({ type: 'lyricsEnable', enabled: false }), 600000);
  } catch (error) { document.title = 'NestuneQA:' + JSON.stringify({ error: String(error) }); }
}, 500), { once: true });
