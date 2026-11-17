export function PlayingIndicator({ playing }: { playing: boolean }) {
  return <span className={`eq playing-indicator ${playing ? '' : 'off'}`} role="img" aria-label={playing ? '正在播放' : '已暂停'}>
    <i /><i /><i />
  </span>;
}
