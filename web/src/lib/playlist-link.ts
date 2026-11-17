export type ExternalPlaylist = { provider: 'netease' | 'qq'; id: string };
export function playlistLink(input: string): ExternalPlaylist | null {
  const direct = /^(netease|qq):([1-9]\d{0,19})$/.exec(input.trim());
  if (direct) return { provider: direct[1] as ExternalPlaylist['provider'], id: direct[2] };
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) return null;
    const hash = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : url;
    const path = hash.pathname, query = hash.searchParams;
    if (['music.163.com', 'y.music.163.com'].includes(url.hostname)) {
      const id = query.get('id') ?? /\/playlist\/(\d+)/.exec(path)?.[1];
      if (/\/(?:m\/)?playlist(?:\/|$)/.test(path) && id && /^[1-9]\d{0,19}$/.test(id)) return { provider: 'netease', id };
    }
    if (['y.qq.com', 'i.y.qq.com', 'c.y.qq.com', 'c6.y.qq.com'].includes(url.hostname)) {
      const id = query.get('disstid') ?? query.get('id') ?? /\/(?:playlist|taoge)\/([1-9]\d*)/.exec(path)?.[1];
      if (/(?:playlist|taoge|songlist)/.test(path) && id && /^[1-9]\d{0,19}$/.test(id)) return { provider: 'qq', id };
    }
  } catch {}
  return null;
}
export const shareUrl = (text: string) => text.match(/https?:\/\/[^\s<>"「」]+/)?.[0].replace(/[，。；！）)]+$/, '') ?? text.trim();
