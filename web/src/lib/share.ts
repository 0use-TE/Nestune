export async function shareLink(title: string, path: string) {
  const url = new URL(path, location.origin).href;
  if (navigator.share) {
    try { await navigator.share({ title, url }); return '已分享'; }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return ''; throw error; }
  }
  await navigator.clipboard.writeText(url);
  return '链接已复制';
}
