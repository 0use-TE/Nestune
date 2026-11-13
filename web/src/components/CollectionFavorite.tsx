'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { del, get, put } from '@/lib/api';
import { useApp } from '@/lib/app';
import { collectionHref, type CollectionFavorite as Favorite, type CollectionKind } from '@/lib/collection-types';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Loading } from './Loading';

const changed = () => window.dispatchEvent(new Event('nt:collection-change'));

export function CollectionFavoriteButton({ kind, id }: { kind: CollectionKind; id: string | number }) {
  const app = useApp();
  const path = `/api/me/collections/${kind}/${id}`;
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFavorite(null); setFailed(false);
    get<{ favorite: boolean }>(path).then(data => { if (live) setFavorite(data.favorite); }).catch(error => {
      if (live) { setFailed(true); app.toast(error.message); }
    });
    return () => { live = false; };
  }, [path, retry, app.toast]);
  async function toggle() {
    if (busy) return;
    if (favorite === null) { setRetry(value => value + 1); return; }
    setBusy(true);
    try {
      const data = await (favorite ? del<{ favorite: boolean }>(path) : put<{ favorite: boolean }>(path));
      setFavorite(data.favorite); changed(); app.toast(data.favorite ? '已收藏' : '已取消收藏');
    } catch (error) { app.toast(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(false); }
  }
  return <button type="button" className={`btn ghost collection-favorite ${favorite ? 'is-collected' : ''}`} aria-pressed={favorite === true}
    disabled={busy || favorite === null && !failed} onClick={toggle}>
    {busy || favorite === null && !failed ? <Loading inline label="正在读取收藏" /> : <Icon n="heart" s={16} />}{favorite ? '已收藏' : failed ? '重试' : '收藏'}
  </button>;
}

export function FavoriteCollections({ category }: { category: 'album' | 'playlist' }) {
  const app = useApp();
  const [items, setItems] = useState<Favorite[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true, version = 0;
    const load = async () => {
      const current = ++version;
      try { const data = await get<{ items: Favorite[] }>('/api/me/collections'); if (live && current === version) { setItems(data.items); setError(''); } }
      catch (error) { if (live && current === version) setError(error instanceof Error ? error.message : '无法加载收藏'); }
    };
    void load(); window.addEventListener('nt:collection-change', load);
    return () => { live = false; window.removeEventListener('nt:collection-change', load); };
  }, [retry]);
  async function remove(item: Favorite) {
    if (busy) return;
    const key = `${item.kind}/${item.id}`; setBusy(key);
    try { await del(`/api/me/collections/${key}`); setItems(current => current?.filter(value => value.kind !== item.kind || value.id !== item.id) ?? null); changed(); }
    catch (error) { app.toast(error instanceof Error ? error.message : '取消收藏失败'); }
    finally { setBusy(null); }
  }
  const shown = items?.filter(item => category === 'album' ? item.kind === 'album' : item.kind !== 'album');
  if (error) return <div className="center"><p className="sub">{error}</p><button className="btn ghost sm" onClick={() => setRetry(value => value + 1)}>重试</button></div>;
  if (!shown) return <Loading />;
  if (!shown.length) return <div className="center sub">暂无收藏的{category === 'album' ? '专辑' : '歌单'}</div>;
  return <div className="grid collection-grid">{shown.map(item => <article key={`${item.kind}/${item.id}`}>
    {item.available ? <Link className="card" href={collectionHref(item.kind, item.id)}><Cover src={item.cover} seed={`${item.kind}${item.id}`} /><b className="t1">{item.name}</b><span className="sub sm t1">{item.sub}</span></Link>
      : <div className="card"><Cover seed={`${item.kind}${item.id}`} /><b className="t1">{item.name}</b></div>}
    <button className="link sm" disabled={busy !== null} aria-label={`取消收藏 ${item.name}`} onClick={() => remove(item)}>{busy === `${item.kind}/${item.id}` ? <Loading inline /> : '取消收藏'}</button>
  </article>)}</div>;
}
