(() => {
  const original = window.fetch.bind(window);
  const person = { id: 2, username: 'layout-peer', name: 'Layout friend', avatar: null, online: true, track: null, friendship: 'friend' };
  const user = { id: 1, username: 'layout-probe', displayName: 'Layout probe', avatar: null, bio: '', email: '', profilePublic: true };
  const state = () => ({ people: [person], rooms: [], inbox: [], showOnline: true, serverTime: Date.now() });
  // All API traffic stays inside this disposable WebView. No real login,
  // messages, read receipts, presence or room changes reach the server.
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return original(input, init);
    let data = {};
    if (url.pathname === '/api/me') data = { user, stats: { plays: 0 } };
    else if (url.pathname === '/api/me/queue') data = { songs: [], index: -1, position: 0 };
    else if (url.pathname === '/api/me/playlists') data = { playlists: [] };
    else if (url.pathname === '/api/me/favorites') data = { songs: [], ids: [] };
    else if (url.pathname === '/api/client-updates') data = { version: '1.0.0', android: null };
    else if (url.pathname === '/api/home') data = { playlists: [], newSongs: [], charts: [] };
    else if (url.pathname === '/api/me/history') data = { songs: [] };
    else if (url.pathname === '/api/search/hot') data = { keywords: [] };
    else if (url.pathname === '/api/social') data = url.searchParams.has('peer') ? {
      messages: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, senderId: i % 2 ? 1 : 2, text: 'Chat layout regression message ' + i, sentAt: Date.now() })), peerReadThrough: 0,
    } : state();
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  localStorage.setItem('nt-install-intro-v1', 'seen');
  const form = document.querySelector('#login form');
  form.querySelector('[name=u]').value = 'layout-probe';
  form.querySelector('[name=p]').value = 'layout-probe';
  form.requestSubmit();
  window.__chatLayoutOK = () => {
    const header = document.querySelector('.social-chat header');
    const composer = document.querySelector('.chat-composer');
    const nav = document.querySelector('#tabbar');
    if (!header || !composer || !nav) return false;
    const top = visualViewport?.offsetTop ?? 0, bottom = top + (visualViewport?.height ?? innerHeight);
    const h = header.getBoundingClientRect(), c = composer.getBoundingClientRect(), n = nav.getBoundingClientRect();
    return h.top >= top - 2 && c.top > h.bottom && c.bottom <= n.top + 2 && n.top - c.bottom < 35 && Math.abs(n.bottom - bottom) < 3;
  };
  return true;
})()
