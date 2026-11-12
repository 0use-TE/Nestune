export function Loading({ inline = false, label = '加载中' }: { inline?: boolean; label?: string }) {
  const animation = <span className="loading-wave" role="status" aria-label={label}>
    <span aria-hidden="true"><i /><i /><i /><i /></span>
  </span>;
  return inline ? animation : <div className="center loading-state">{animation}</div>;
}
