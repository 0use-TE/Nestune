'use client';
import { useEffect, useState } from 'react';
import { del, get, put } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { CollectionKind } from '@/lib/collection-types';
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
