import { Icon } from './Icon';

export function RecentSearches({ keywords, onPick, onRemove }: {
  keywords: string[]; onPick: (keyword: string) => void; onRemove: (keyword: string) => void;
}) {
  return (
    <div className="search-history">
      {keywords.map(keyword => (
        <div className="recent-chip" key={keyword}>
          <button type="button" className="chip recent-chip-label t1" title={keyword} onClick={() => onPick(keyword)}>{keyword}</button>
          <button type="button" className="recent-chip-remove" aria-label={`删除搜索记录「${keyword}」`}
            title="删除这条记录" onClick={() => onRemove(keyword)}><Icon n="x" s={12} /></button>
        </div>
      ))}
    </div>
  );
}
