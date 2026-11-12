'use client';
import { Loading } from '@/components/Loading';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { get } from '@/lib/api';
import { recentSearches, saveRecentSearches, useSearchSuggestions } from '@/lib/search';
import type { Song } from '@/lib/types';
import { fmtCount } from '@/lib/util';
import { Cover } from '@/components/Cover';
import { Icon } from '@/components/Icon';
import { RecentSearches } from '@/components/RecentSearches';
import { Empty, SongList } from '@/components/SongList';

const TYPES = [['song', '歌曲'], ['artist', '歌手'], ['album', '专辑'], ['playlist', '歌单']] as const;
type SearchType = (typeof TYPES)[number][0];
type Item = any;

export default function SearchPage() {
  return <Suspense fallback={<Loading />}><SearchRoute /></Suspense>;
}

function SearchRoute() {
  const keywords = useSearchParams().get('q')?.trim() || '';
  return <SearchView key={keywords} initialQuery={keywords} />;
}

function SearchView({ initialQuery }: { initialQuery: string }) {
  const [q, setQ] = useState(initialQuery);
  const [type, setType] = useState<SearchType>('song');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hot, setHot] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const seq = useRef(0);
  const lastRun = useRef('');
  const input = useRef<HTMLInputElement>(null);
  const sugg = useSearchSuggestions(q, q.trim() !== lastRun.current);

  useEffect(() => {
    setRecent(recentSearches());
    get('/api/search/hot').then(r => setHot(r.keywords)).catch(() => {});
    if (!initialQuery) input.current?.focus();
  }, [initialQuery]);

  const run = useCallback(async (keywords: string, t: SearchType, offset = 0) => {
    const k = keywords.trim();
    const my = ++seq.current;
    lastRun.current = k;
    if (!k) { setItems([]); setTotal(0); setBusy(false); setErr(''); return; }
    if (!offset) { setItems([]); setTotal(0); }
    setBusy(true); setErr('');
    try {
      const r = await get(`/api/search?keywords=${encodeURIComponent(k)}&type=${t}&limit=30&offset=${offset}`);
      if (my !== seq.current) return;
      setItems(offset ? p => [...p, ...r.items] : r.items); setTotal(r.total);
      if (!offset) {
        const next = [k, ...recentSearches().filter(x => x !== k)].slice(0, 8);
        saveRecentSearches(next);
        setRecent(next);
      }
    } catch (e: any) { if (my === seq.current) setErr(e.message); }
    if (my === seq.current) setBusy(false);
  }, []);

  useEffect(() => {
    if (initialQuery) run(initialQuery, 'song');
    return () => { seq.current++; };
  }, [initialQuery, run]);

  const pick = (k: string) => { setQ(k); run(k, type); };
  function updateRecent(keywords: string[]) {
    saveRecentSearches(keywords);
    setRecent(keywords);
    input.current?.focus();
  }
  const searched = !!lastRun.current;

  return (
    <>
      <h1 style={{ marginBottom: 22 }}>搜索</h1>
      <form className="search" role="search" onSubmit={e => { e.preventDefault(); run(q, type); }}>
        <Icon n="search" />
        <input ref={input} aria-label="搜索歌曲、歌手、专辑、歌单" value={q} onChange={e => setQ(e.target.value)} placeholder="搜索歌曲、歌手、专辑、歌单" />
        {sugg.length > 0 && q.trim() && (
          <div className="sugg">{sugg.map(s => <button type="button" key={s} onClick={() => pick(s)}>{s}</button>)}</div>
        )}
      </form>
      <div className="chips">
        {TYPES.map(([k, label]) => <button key={k} className={`chip ${type === k ? 'on' : ''}`} onClick={() => { setType(k); run(q, k); }}>{label}</button>)}
      </div>

      {!searched && (
        <>
          {recent.length > 0 && (
            <>
              <div className="sec" style={{ marginTop: 10 }}><h2>最近搜索</h2><button className="link" onClick={() => updateRecent([])}>清空</button></div>
              <RecentSearches keywords={recent} onPick={pick} onRemove={keyword => updateRecent(recent.filter(item => item !== keyword))} />
            </>
          )}
          {hot.length > 0 && (
            <>
              <div className="sec"><h2>热门搜索</h2></div>
              <div className="row">{hot.slice(0, 12).map(k => <button key={k} className="chip" onClick={() => pick(k)}>{k}</button>)}</div>
            </>
          )}
        </>
      )}

      {err && <div className="note">{err}</div>}
      {busy && !items.length && <Loading />}
      {!busy && !err && q.trim() && searched && !items.length && <Empty text="没有找到相关内容，试试换个关键词。" />}

      {type === 'song' && <SongList songs={items as Song[]} />}
      {type !== 'song' && items.length > 0 && (
        <div className="grid">
          {items.map((it: any) => (
            <Link key={it.id} href={`/${type}/${it.id}`} className={`card ${type === 'artist' ? 'round' : ''}`}>
              <Cover src={it.cover} seed={it.id} />
              <b className="t1" style={type === 'artist' ? { textAlign: 'center' } : undefined}>{it.name}</b>
              <span className="sub sm t1" style={type === 'artist' ? { display: 'block', textAlign: 'center' } : undefined}>
                {type === 'album' && it.artists?.map((a: any) => a.name).join(' / ')}
                {type === 'playlist' && `${it.trackCount ?? ''} 首 · ${fmtCount(it.playCount)}`}
                {type === 'artist' && `${it.albumSize ?? 0} 张专辑`}
              </span>
            </Link>
          ))}
        </div>
      )}
      {items.length > 0 && items.length < total && (
        <div className="center" style={{ padding: '30px 0' }}><button className="btn ghost" disabled={busy} onClick={() => run(lastRun.current, type, items.length)}>{busy ? <Loading inline label="加载中" /> : '加载更多'}</button></div>
      )}
    </>
  );
}
