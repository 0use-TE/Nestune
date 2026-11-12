'use client';
import { useEffect, useRef, useState } from 'react';
import { api, del, get } from '@/lib/api';
import { useApp } from '@/lib/app';
import { useSocial } from '@/lib/social';
import { MAX_UPLOAD_AUDIO, MAX_UPLOAD_LYRICS, UPLOAD_VISIBILITY, type ManagedUpload, type UploadVisibility } from '@/lib/upload-types';
import { fmtDate, mmss } from '@/lib/util';
import { Cover } from './Cover';
import { Icon } from './Icon';

export function ManageUploads() {
  const app = useApp();
  const [items, setItems] = useState<ManagedUpload[] | null>(null);
  const [editing, setEditing] = useState<ManagedUpload | 'new' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    get<{ uploads: ManagedUpload[] }>('/api/uploads?scope=mine').then(data => { if (live) setItems(data.uploads); })
      .catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, []);

  async function remove(item: ManagedUpload) {
    if (!confirm(`删除《${item.song.name}》及其上传文件？`)) return;
    setRemoving(item.song.id);
    try {
      await del(`/api/uploads/${item.song.id}`);
      setItems(items => items?.filter(upload => upload.song.id !== item.song.id) ?? []);
      void app.reloadPlaylists();
      app.toast('已删除歌曲');
    } catch (error) { app.toast(error instanceof Error ? error.message : '删除失败'); }
    finally { setRemoving(null); }
  }

  return <section aria-label="我的上传" className="uploads-settings">
    <div className="uploads-heading">
      <div><h2>我的上传</h2></div>
      {editing === null && <button className="btn sm" disabled={!items} onClick={() => setEditing('new')}><Icon n="plus" s={16} />上传歌曲</button>}
    </div>
    {error && <p className="err" role="alert">{error}</p>}
    {editing !== null && <UploadForm key={editing === 'new' ? 'new' : editing.song.id} item={editing === 'new' ? null : editing}
      onClose={() => setEditing(null)} onSaved={saved => {
        setItems(items => [saved, ...(items ?? []).filter(item => item.song.id !== saved.song.id)].sort((a, b) => b.createdAt - a.createdAt));
        setEditing(null);
        void app.reloadPlaylists();
        app.toast(editing === 'new' ? '歌曲已上传' : '歌曲已更新');
      }} />}
    {!items && !error && <p className="center sub">加载歌曲…</p>}
    {items && !items.length && editing === null && <p className="center sub">还没有上传过歌曲</p>}
    {!!items?.length && <div className="panel uploads-list">
      {items.map(item => (
        <div className="uploads-row" key={item.song.id}>
          <button type="button" className="uploads-song" onClick={() => app.play([item.song])} aria-label={`播放 ${item.song.name}`}>
            <Cover src={item.song.cover} seed={item.song.id} />
            <span className="uploads-song-text"><b className="t1">{item.song.name}</b><small className="sub t1">{[item.artist, mmss(item.song.duration), fmtDate(item.createdAt)].filter(Boolean).join(' · ')}</small></span>
          </button>
          <span className="uploads-visibility">{UPLOAD_VISIBILITY[item.visibility]}{item.visibility === 'shared' && ` · ${item.recipients.length} 人`}</span>
          <div className="uploads-actions">
            <button type="button" className="link" disabled={editing !== null || !!removing} onClick={() => setEditing(item)}>编辑</button>
            <button type="button" className="ib" disabled={editing !== null || !!removing} aria-label={`删除 ${item.song.name}`} onClick={() => remove(item)}><Icon n="trash" s={16} /></button>
          </div>
        </div>
      ))}
    </div>}
  </section>;
}

function UploadForm({ item, onClose, onSaved }: { item: ManagedUpload | null; onClose: () => void; onSaved: (upload: ManagedUpload) => void }) {
  const social = useSocial();
  const friends = social.state?.people.filter(person => person.friendship === 'friend') ?? [];
  const [fields, setFields] = useState({
    name: item?.song.name ?? '', artist: item?.artist ?? '', album: item?.song.album.name ?? '',
    lyricist: item?.lyricist ?? '', composer: item?.composer ?? '', lyrics: item?.lyrics ?? '',
  });
  const [audio, setAudio] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [visibility, setVisibility] = useState<UploadVisibility>(item?.visibility ?? 'private');
  const [recipients, setRecipients] = useState(item?.recipients ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selection = useRef(0);

  async function pickAudio(file: File | null) {
    const version = ++selection.current;
    setAudio(file);
    setError('');
    if (!file) return;
    if (file.size > MAX_UPLOAD_AUDIO) { setAudio(null); setError('音频不能超过 64 MB'); return; }
    const fallback = file.name.replace(/\.[^.]+$/, '').slice(0, 160);
    try {
      const { parseBlob } = await import('music-metadata');
      const { common } = await parseBlob(file, { skipCovers: true });
      if (version !== selection.current) return;
      setFields(current => ({
        ...current, name: current.name || (common.title || fallback).slice(0, 160),
        artist: current.artist || (common.artists?.join(' / ') || common.artist || '').slice(0, 160),
        album: current.album || (common.album || '').slice(0, 160),
        composer: current.composer || (common.composer?.join(' / ') || '').slice(0, 160),
        lyricist: current.lyricist || (common.lyricist?.join(' / ') || '').slice(0, 160),
      }));
    } catch {
      if (version === selection.current) setFields(current => ({ ...current, name: current.name || fallback }));
    }
  }

  async function pickLyrics(file?: File) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_LYRICS) { setError('歌词文件不能超过 128 KB'); return; }
    try { const lyrics = await file.text(); setFields(current => ({ ...current, lyrics })); setError(''); }
    catch { setError('无法读取歌词文件'); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    if (audio) form.set('audio', audio);
    if (cover) form.set('cover', cover);
    if (removeCover) form.set('removeCover', '1');
    form.set('visibility', visibility);
    for (const id of recipients) form.append('recipients', String(id));
    try {
      const path = item ? `/api/uploads/${item.song.id}` : '/api/uploads';
      const data = await api<{ upload: ManagedUpload }>(path, { method: item ? 'PATCH' : 'POST', body: form });
      onSaved(data.upload);
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="panel pad upload-form">
    <h2>{item ? '编辑歌曲' : '上传歌曲'}</h2>
    <fieldset disabled={busy}>
      {!item && <label className="field">音频文件 <span className="sub sm">MP3、FLAC、M4A、WAV 或 OGG，最大 64 MB</span>
        <input type="file" accept=".mp3,.flac,.m4a,.wav,.ogg,.opus" onChange={e => void pickAudio(e.target.files?.[0] ?? null)} required />
      </label>}
      <div className="settings-fields">
        {([['name', '歌名'], ['artist', '歌手'], ['album', '专辑'], ['lyricist', '作词'], ['composer', '作曲']] as const).map(([key, label]) => (
          <label className="field" key={key}>{label}{key !== 'name' && <span className="sub sm"> 选填</span>}
            <input required={key === 'name'} maxLength={160} value={fields[key]} onChange={e => setFields(current => ({ ...current, [key]: e.target.value }))} />
          </label>
        ))}
        <label className="field">封面 <span className="sub sm">选填，PNG、JPG、WebP，最大 2 MB</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { setCover(e.target.files?.[0] ?? null); setRemoveCover(false); }} />
        </label>
      </div>
      {item?.song.cover && <label className="upload-check"><input type="checkbox" checked={removeCover} onChange={e => setRemoveCover(e.target.checked)} />移除原封面</label>}
      <label className="field">歌词 <span className="sub sm">选填，上传 LRC 或粘贴文本</span>
        <textarea rows={4} maxLength={MAX_UPLOAD_LYRICS} value={fields.lyrics} onChange={e => setFields(current => ({ ...current, lyrics: e.target.value }))} />
      </label>
      <label className="field upload-lyrics-file">歌词文件<input type="file" accept=".lrc,.txt" onChange={e => void pickLyrics(e.target.files?.[0])} /></label>
      <div className="upload-visibility-options" role="group" aria-label="可见范围">
        {(Object.entries(UPLOAD_VISIBILITY) as [UploadVisibility, string][]).map(([value, label]) => (
          <label className="upload-check" key={value}><input type="radio" name="visibility" checked={visibility === value} onChange={() => setVisibility(value)} />{label}</label>
        ))}
      </div>
      {visibility === 'shared' && <div className="upload-friends" role="group" aria-label="选择共享好友">
        {friends.length ? friends.map(friend => <label className="upload-check" key={friend.id}>
          <input type="checkbox" checked={recipients.includes(friend.id)} onChange={e => setRecipients(current => e.target.checked ? [...current, friend.id] : current.filter(id => id !== friend.id))} />{friend.name}
        </label>) : <p className="sub sm">{social.state ? '添加好友后即可选择共享对象。' : '正在加载好友…'}</p>}
      </div>}
      {visibility === 'public' && <p className="sub sm">所有登录用户都能找到这首歌，并看到你的昵称。</p>}
    </fieldset>
    {error && <p className="err" role="alert">{error}</p>}
    <div className="settings-save row">
      <button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>取消</button>
      <button className="btn sm" disabled={busy || (!item && !audio) || !fields.name.trim() || (visibility === 'shared' && !recipients.length)}>
        {busy ? '保存中…' : item ? '保存修改' : '上传歌曲'}
      </button>
    </div>
  </form>;
}
