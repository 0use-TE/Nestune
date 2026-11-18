/** Move only the closest scrolling list; keep the player and page underneath fixed. */
export function locateSong(row: HTMLElement | null) {
  if (!row) return;
  let container = row.parentElement;
  while (container && !/(auto|scroll)/.test(getComputedStyle(container).overflowY)) container = container.parentElement;
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  if (container) {
    const bounds = container.getBoundingClientRect(), target = row.getBoundingClientRect();
    container.scrollTo({ top: container.scrollTop + target.top - bounds.top - (container.clientHeight - target.height) / 2, behavior });
  } else row.scrollIntoView({ block: 'center', behavior });
  row.focus({ preventScroll: true });
  row.classList.remove('song-located');
  void row.offsetWidth;
  row.classList.add('song-located');
}
