'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, post } from '@/lib/api';
import { useApp } from '@/lib/app';
import { useSocial } from '@/lib/social';
import type { DomainDetail, DomainMessage, DomainSummary } from '@/lib/social-types';
import type { Song } from '@/lib/types';
import { Avatar, Cover } from './Cover';
import { ChatSongPicker } from './ChatSongPicker';
import { Icon } from './Icon';
import { ListeningRoomChat, ListeningRoomControls } from './ListeningRoom';
import { Loading } from './Loading';
import { PlayerTogether } from './PlayerTogether';
import { Sheet } from './Sheet';

export const domainListHref = '/social?tab=domains';
export const domainHref = (id: number) => domainListHref + '&domain=' + id;

function refreshDomains() { window.dispatchEvent(new Event('nt:domain-refresh')); }

async function writeDomain<T = { ok: boolean; added?: boolean }>(data: Record<string, unknown>) {
  const result = await post<T>('/api/domains', data);
  refreshDomains();
  return result;
}

function useDomains<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  useEffect(() => {
    let request: AbortController | undefined;
    function refresh() {
      request?.abort();
      const next = new AbortController();
      request = next;
      api<T>(path, { signal: next.signal }).then(value => {
        if (!next.signal.aborted) { setData(value); setError(''); }
      }).catch(error => {
        if (!next.signal.aborted) setError(error instanceof Error ? error.message : '域暂时无法加载');
      });
    }
    function onVisible() { if (!document.hidden) refresh(); }
    refresh();
    window.addEventListener('nt:domain-refresh', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      request?.abort();
      window.removeEventListener('nt:domain-refresh', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [path]);
  return { data, error };
}

export function Domains({ domainId }: { domainId: number | null }) {
  return domainId ? <DomainPage key={domainId} id={domainId} /> : <DomainList />;
}

function DomainList() {
  const { me, toast } = useApp();
  const router = useRouter();
  const { state } = useSocial();
  const { data, error } = useDomains<{ domains: DomainSummary[] }>('/api/domains');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const previous = state?.rooms.find(room => !room.domain && room.active);
  const pending = state?.rooms.some(room => !room.active && room.inviteId);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { id } = await writeDomain<{ id: number }>({ action: 'create', name: name.trim() });
      setCreating(false); router.push(domainHref(id));
    } catch (error) { toast(error instanceof Error ? error.message : '创建域失败'); }
    finally { setBusy(false); }
  }

  async function answer(domainId: number, accept: boolean) {
    setBusy(true);
    try {
      await writeDomain({ action: accept ? 'accept' : 'decline', domainId });
      if (accept) router.push(domainHref(domainId));
    } catch (error) { toast(error instanceof Error ? error.message : '无法处理邀请'); }
    finally { setBusy(false); }
  }

  return <section className="domains" aria-label="域列表">
    <div className="domain-list-toolbar"><button type="button" className="btn sm" onClick={() => setCreating(true)}><Icon n="plus" s={16} />创建域</button></div>
    {error && <p role="alert" className="err">{error}</p>}
    {!data && !error && <Loading />}
    {data?.domains.length === 0 && <p className="sub domain-empty">还没有加入域</p>}
    <ul className="domain-list">
      {data?.domains.map(domain => <li key={domain.id}>
        {domain.invited ? <div className="domain-row">
          <div className="domain-row-icon"><Icon n="users" s={20} /></div>
          <div className="domain-row-info"><b className="t1">{domain.name}</b><small className="sub">邀请你加入</small></div>
          <button type="button" className="btn sm" disabled={busy} onClick={() => void answer(domain.id, true)}>接受</button>
          <button type="button" className="link" disabled={busy} onClick={() => void answer(domain.id, false)}>拒绝</button>
        </div> : <Link className="domain-row" href={domainHref(domain.id)}>
          <div className="domain-row-icon"><Icon n="users" s={20} /></div>
          <div className="domain-row-info"><b className="t1">{domain.name}</b>
            <small className="sub t1">{domain.members} 位成员{domain.track ? ` · 正在听 ${domain.track}` : domain.listeners ? ` · ${domain.listeners} 人在听` : ''}</small>
          </div><Icon n="forward" s={17} />
        </Link>}
      </li>)}
    </ul>
    {previous?.group && <details className="domain-temporary">
      <summary className="domain-row"><Icon n="users" s={18} /><b className="domain-row-info">临时一起听</b><Icon n="down" s={17} /></summary>
      <div className="domain-legacy">
        <ListeningRoomControls key={previous.id} room={previous} />
        <ListeningRoomChat key={previous.id} room={previous} />
      </div>
    </details>}
    {me && !previous?.group && (pending || previous && !previous.onThisDevice) && <PlayerTogether inviting={false} onClose={() => {}} active={null} />}
    {creating && <Sheet title="创建域" onClose={() => setCreating(false)}>
      <form className="domain-create" onSubmit={create}>
        <label>域名<input autoFocus maxLength={32} value={name} onChange={event => setName(event.target.value)} /></label>
        <button className="btn sm" disabled={busy || !name.trim()}>创建</button>
      </form>
    </Sheet>}
  </section>;
}

function DomainPage({ id }: { id: number }) {
  const app = useApp();
  const { state, action: socialAction } = useSocial();
  const router = useRouter();
  const { data, error } = useDomains<{ domain: DomainDetail }>('/api/domains?id=' + id);
  const domain = data?.domain;
  const [panel, setPanel] = useState<'playlist' | 'members' | null>(null);
  const [picker, setPicker] = useState<'domain-share' | 'domain-add' | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [peer, setPeer] = useState('');
  const [older, setOlder] = useState<{ messages: DomainMessage[]; hasEarlier: boolean }>();
  const list = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const live = state?.rooms.find(room => room.active && room.domain?.id === id);
  const here = live?.onThisDevice ? live : null;
  const owner = domain?.ownerId === app.me?.id;
  const canControl = !!here && here.hostId === app.me?.id;
  const recent = domain?.messages;
  const latestMsg = recent?.at(-1)?.id;

  useEffect(() => {
    if (list.current && followBottom.current) list.current.scrollTop = list.current.scrollHeight;
  }, [latestMsg]);

  async function doAction<T>(work: () => Promise<T>) {
    setBusy(true);
    try { return await work(); }
    catch (error) { app.toast(error instanceof Error ? error.message : '域操作失败'); }
    finally { setBusy(false); }
  }
  const write = (data: Record<string, unknown>) => writeDomain({ ...data, domainId: id });
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    await doAction(async () => { followBottom.current = true; await write({ action:'message', text: draft.trim() }); setDraft(''); });
  }
  function chooseSong(songId: string) {
    if (!picker || busy) return;
    void doAction(async () => {
      if (picker === 'domain-share') followBottom.current = true;
      const result = await write({ action: picker === 'domain-add' ? 'add' : 'share', songId });
      if (picker === 'domain-add') app.toast(result.added ? '已添加到域歌单' : '域歌单里已经有这首歌了');
      setPicker(null);
    });
  }
  async function loadEarlier() {
    const before = older?.messages[0]?.id ?? recent?.[0]?.id;
    const node = list.current;
    if (!before || !node) return;
    const offset = node.scrollHeight - node.scrollTop;
    await doAction(async () => {
      const previous = await api<{ messages: DomainMessage[]; hasEarlier: boolean }>(`/api/domains?id=${id}&before=${before}`);
      followBottom.current = false;
      setOlder({ ...previous, messages: [...previous.messages, ...(older?.messages ?? [])] });
      requestAnimationFrame(() => { node.scrollTop = node.scrollHeight - offset; });
    });
  }

  const messages = [...(older?.messages ?? []), ...(recent ?? [])];
  const friends = state?.people.filter(person => person.friendship === 'friend' && !domain?.memberIds.includes(person.id) && !domain?.pendingIds.includes(person.id)) ?? [];
  const nameOf = (userId: number | null) => state?.people.find(person => person.id === userId)?.name || '成员';
  return <article className="domain-page">
    <header className="domain-heading">
      <Link className="ib" href={domainListHref} aria-label="返回域列表" title="返回域列表"><Icon n="back" /></Link>
      <h2 className="t1">{domain?.name ?? '域'}</h2>
      {domain && <div className="domain-tools">
        <button type="button" className="ib" aria-label="域成员" title="域成员" onClick={() => setPanel('members')}><Icon n="users" s={19} /></button>
        <button type="button" className="ib" aria-label="域歌单" title="域歌单" onClick={() => setPanel('playlist')}><Icon n="list" s={19} /></button>
      </div>}
    </header>
    {error && <p role="alert" className="err">{error}</p>}
    {!domain && !error && <Loading />}
    {domain && <>
      <div className="domain-player">
        <Icon n="note" s={19} />
        <div className="domain-row-info"><b className="t1">{domain.track || (!domain.listeners ? '一起听' : '同步播放已暂停')}</b>
          <small className="sub">{domain.listeners ? `${domain.listeners} 人在听` : '暂无人在听'}{here && canControl && ' · 你控制播放'}</small>
        </div>
        {canControl && here?.playback && <button type="button" className="ib" aria-label={here.playback.playing ? '暂停域播放' : '开始域播放'}
          onClick={() => app.toggle()}><Icon n={here.playback.playing ? 'pause' : 'play'} s={18} /></button>}
        <button type="button" className={`btn sm ${here ? 'ghost' : ''}`} disabled={busy || !!live && !here}
          onClick={() => void doAction(() => here ? socialAction({ action:'leave', roomId:here.id }) : socialAction({ action:'joinDomain', domainId:id }))}>
          {here ? '退出同步' : live ? '另一台设备在听' : '加入一起听'}
        </button>
      </div>
      <section className="social-chat domain-chat" aria-label="域群聊">
        <div className="social-messages" ref={list} role="log" onScroll={event => {
          const node = event.currentTarget;
          followBottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < 70;
        }}>
          {(older?.hasEarlier ?? domain.hasEarlier) && <button className="link social-earlier" disabled={busy} onClick={() => void loadEarlier()}>更早的消息</button>}
          {!messages.length && <p className="center sub">暂无消息</p>}
          {messages.map(message => {
            const mine = message.senderId === app.me?.id;
            return <div className={`message-entry ${mine ? 'mine' : ''}`} key={message.id}>
              {!mine && <small className="message-meta">{nameOf(message.senderId)}</small>}
              {message.song ? <div className="chat-song-card chat-song-row domain-song-card">
                <Cover src={message.song.cover} seed={message.song.id} />
                <span className="chat-song-text"><b className="t1">{message.song.name}</b><small className="t1">{message.song.artist}</small></span>
                <button className="ib" aria-label="添加到域歌单" title="添加到域歌单" disabled={busy} onClick={() => void doAction(async () => {
                  const saved = await write({ action:'add', songId:message.song!.id });
                  app.toast(saved.added ? '已添加到域歌单' : '域歌单里已经有这首歌了');
                })}><Icon n="plus" s={17} /></button>
              </div> : <p className={`social-message ${mine ? 'mine' : ''}`}>{message.text}</p>}
            </div>;
          })}
        </div>
        <div className="chat-composer"><form onSubmit={send}>
          <button type="button" className="ib" aria-label="分享歌曲" title="分享歌曲" disabled={busy} onClick={() => setPicker('domain-share')}><Icon n="note" s={18} /></button>
          <input aria-label="域消息" placeholder="输入消息" maxLength={1000} value={draft} onChange={event => setDraft(event.target.value)} />
          <button className="ib" aria-label="发送消息" disabled={busy || !draft.trim()}><Icon n="send" s={17} /></button>
        </form></div>
      </section>
      {panel === 'playlist' && !picker && <Sheet title="域歌单" onClose={() => setPanel(null)}>
        <div className="domain-sheet-actions">
          <button type="button" className="btn sm" onClick={() => setPicker('domain-add')}><Icon n="plus" s={17} />添加歌曲</button>
          {canControl && <button type="button" className="btn ghost sm" disabled={busy || !domain.songs.length} onClick={() => void doAction(async () => {
            await socialAction({ action:'roomQueue', roomId:here!.id, command:{ type:'replace', songIds:domain.songs.map(({song}) => song.id), index:0 } });
            setPanel(null);
          })}>播放域歌单</button>}
        </div>
        {!domain.songs.length && <p className="sub domain-empty">域歌单还没有歌曲</p>}
        <ul className="domain-song-list">{domain.songs.map(({ song, addedBy }) => <li key={song.id}>
          <Cover src={song.cover} seed={song.id} />
          <span className="domain-row-info"><b className="t1">{song.name}</b><small className="sub t1">{song.artists.map(artist => artist.name).join(' / ')} · {nameOf(addedBy)} 添加</small></span>
          {canControl && <button type="button" className="ib" aria-label={`播放 ${song.name}`} title="播放" disabled={busy} onClick={() => void doAction(async () => {
            await socialAction({ action:'roomQueue', roomId:here!.id, command:{type:'playNow', songId:song.id} }); setPanel(null);
          })}><Icon n="play" s={17} /></button>}
          {(owner || addedBy === app.me?.id) && <button type="button" className="ib" disabled={busy} aria-label={`从域歌单移除 ${song.name}`} title="从域歌单移除"
            onClick={() => void doAction(() => write({ action:'remove', songId:song.id }))}><Icon n="x" s={16} /></button>}
        </li>)}</ul>
      </Sheet>}
      {panel === 'members' && <Sheet title="域成员" onClose={() => setPanel(null)}>
        <ul className="listening-members">{domain.memberIds.map(userId => <li key={userId}>
          <Avatar name={nameOf(userId)} src={state?.people.find(person => person.id === userId)?.avatar} />
          <span className="t1">{nameOf(userId)}</span>{userId === domain.ownerId && <small className="sub">域主</small>}
        </li>)}</ul>
        {owner ? <form className="listening-invite" onSubmit={event => {
          event.preventDefault(); if (peer) void doAction(async () => { await write({ action:'invite', peerId:Number(peer) }); setPeer(''); app.toast('域邀请已发送'); });
        }}>
          <select aria-label="选择好友" value={peer} onChange={event => setPeer(event.target.value)}><option value="">{friends.length ? '选择好友' : '暂无可邀请好友'}</option>
            {friends.map(friend => <option key={friend.id} value={friend.id}>{friend.name}</option>)}
          </select>
          <button className="btn sm" disabled={busy || !peer}>邀请好友</button>
          {!!domain.pendingIds.length && <small className="sub">{domain.pendingIds.length} 个待接受</small>}
        </form> : <button type="button" className="link" disabled={busy} onClick={() => void doAction(async () => {
          await write({ action:'leave' }); dispatchEvent(new Event('nt:social-refresh')); router.replace(domainListHref);
        })}>退出域</button>}
      </Sheet>}
      {picker && <ChatSongPicker current={app.current} busy={busy} purpose={picker} onShare={chooseSong} onClose={() => setPicker(null)} />}
    </>}
  </article>;
}

export function AddToDomain({ song, onClose }: { song: Song; onClose: () => void }) {
  const app = useApp();
  const { data, error } = useDomains<{ domains: DomainSummary[] }>('/api/domains');
  const [busy, setBusy] = useState(false);
  const list = data?.domains.filter(domain => !domain.invited);
  async function add(id: number) {
    setBusy(true);
    try {
      const result = await writeDomain({ action:'add', domainId:id, songId:song.id });
      app.toast(result.added ? '已添加到域歌单' : '域歌单里已经有这首歌了');
      onClose();
    } catch (error) { app.toast(error instanceof Error ? error.message : '添加失败'); }
    finally { setBusy(false); }
  }
  return <Sheet title="添加到域歌单" onClose={onClose}>
    {error && <p role="alert" className="err">{error}</p>}
    {!data && !error && <Loading />}
    {list?.length === 0 && <Link href={domainListHref} className="link" onClick={() => { app.setNowOpen(false); onClose(); }}>先创建或加入一个域</Link>}
    <ul className="domain-list">{list?.map(domain => <li key={domain.id}><button type="button" className="domain-row" disabled={busy} onClick={() => void add(domain.id)}>
      <Icon n="users" s={18} /><b className="t1">{domain.name}</b><Icon n="plus" s={18} />
    </button></li>)}</ul>
  </Sheet>;
}
