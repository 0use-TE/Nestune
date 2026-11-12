'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { get } from '@/lib/api';
import { recentSearches, saveRecentSearches, useSearchSuggestions } from '@/lib/search';
import { Icon } from './Icon';
import { RecentSearches } from './RecentSearches';

export function HomeSearch() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [hot, setHot] = useState<string[] | null>(null);
  const suggestions = useSearchSuggestions(query, open);
  const typing = !!query.trim();
  const showHints = open && (typing ? suggestions.length > 0 : recent.length > 0 || !!hot?.length);

  useEffect(() => {
    if (!open || hot) return;
    let live = true;
    get<{ keywords: string[] }>('/api/search/hot').then(response => {
      if (live) setHot(response.keywords);
    }).catch(() => {});
    return () => { live = false; };
  }, [hot, open]);

  function submit(value: string) {
    setOpen(false);
    const keywords = value.trim().slice(0, 50);
    router.push(keywords ? `/search?q=${encodeURIComponent(keywords)}` : '/search');
  }

  function updateRecent(keywords: string[]) {
    saveRecentSearches(keywords);
    input.current?.focus();
    setRecent(keywords);
  }

  return (
    <form className="search home-search" role="search" onSubmit={event => { event.preventDefault(); submit(query); }}
      onFocus={() => { setRecent(recentSearches()); setOpen(true); }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); input.current?.focus(); setOpen(false); }
      }}>
      <input ref={input} type="search" aria-label="搜索歌曲、歌手、专辑、歌单" placeholder="搜索歌曲、歌手、专辑、歌单"
        value={query} onChange={event => { setQuery(event.target.value); setOpen(true); }} onClick={() => setOpen(true)} maxLength={50} />
      <button className="ib" type="submit" aria-label="搜索"><Icon n="search" /></button>
      {showHints && (
        <div className={`sugg ${typing ? '' : 'search-discovery'}`} aria-label="搜索推荐">
          {typing ? suggestions.map(keyword => <button key={keyword} type="button" onClick={() => submit(keyword)}>{keyword}</button>) : (
            <>
              {recent.length > 0 && (
                <section>
                  <div className="search-hints-heading"><h2>搜索历史</h2><button type="button" className="link" onClick={() => updateRecent([])}
                    aria-label="清空搜索历史" title="清空搜索历史"><Icon n="trash" s={15} /></button></div>
                  <RecentSearches keywords={recent.slice(0, 8)} onPick={submit} onRemove={keyword => updateRecent(recent.filter(item => item !== keyword))} />
                </section>
              )}
              {!!hot?.length && (
                <section className="search-hot">
                  <h2>热搜榜</h2>
                  <ol>{hot.slice(0, 9).map((keyword, index) => <li key={`${keyword}-${index}`}><button type="button" title={keyword} onClick={() => submit(keyword)}><span>{index + 1}</span><b className="t1">{keyword}</b></button></li>)}</ol>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </form>
  );
}
