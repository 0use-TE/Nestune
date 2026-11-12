'use client';
import { useId, useRef, useState } from 'react';
import { useApp } from '@/lib/app';
import { useSocial } from '@/lib/social';
import type { ListeningRoom, Person } from '@/lib/social-types';
import { Avatar } from './Cover';
import { Icon } from './Icon';

export function PlayerTogether({ inviting, onClose, active }: {
  inviting: boolean; onClose: () => void; active: { room: ListeningRoom; peer: Person } | null;
}) {
  const app = useApp();
  const { state, action, playbackError } = useSocial();
  const me = app.me!;
  const [peerId, setPeerId] = useState('');
  const [busy, setBusy] = useState(false);
  const room = active?.room;
  const roomOnAnotherDevice = state?.rooms.some(item => item.active && !item.onThisDevice);
  const pending = state?.rooms.find(item => !item.active && item.guestId === me.id) ?? state?.rooms.find(item => !item.active);
  const activePeer = active?.peer;
  const pendingPeer = pending && state?.people.find(person => person.id === (pending.hostId === me.id ? pending.guestId : pending.hostId));
  const friends = state?.people.filter(person => person.friendship === 'friend') ?? [];
  const selected = friends.find(person => String(person.id) === peerId);
  const playing = room?.playback?.playing ?? app.playing;

  async function change(data: Record<string, unknown>) {
    setBusy(true);
    try {
      await action(data);
      if (data.action === 'invite' || data.action === 'acceptInvite') onClose();
    }
    catch (e) { app.toast(e instanceof Error ? e.message : '一起听操作失败'); }
    finally { setBusy(false); }
  }

  if (room && activePeer) return (
    <section className="player-together active" aria-label="一起听">
      <header className="together-header">
        <div className="together-avatars" aria-label={`${me.displayName} 和 ${activePeer.name}`}>
          <Avatar src={me.avatar} name={me.displayName} /><Avatar src={activePeer.avatar} name={activePeer.name} />
        </div>
        <div className="together-status"><b>{playing ? '正在一起听' : '一起听 · 已暂停'}</b><small className="t1">你和 {activePeer.name}</small></div>
        <button className="link" disabled={busy} onClick={() => change({ action: 'leave', roomId: room.id })}>退出</button>
      </header>
      {playbackError && <p className="err" role="alert">{playbackError}</p>}
    </section>
  );

  if (roomOnAnotherDevice) return (
    <div className="player-together sub sm" role="status">已在另一台设备加入一起听</div>
  );

  if (pending && pendingPeer) {
    const incoming = pending.guestId === me.id;
    return (
      <section className="player-together together-invite" aria-label="一起听邀请">
        <Avatar src={pendingPeer.avatar} name={pendingPeer.name} />
        <span className="together-status">{incoming ? `${pendingPeer.name} 邀请你一起听` : `等待 ${pendingPeer.name} 接受邀请`}</span>
        {incoming && <button className="btn sm" disabled={busy} onClick={() => change({ action: 'acceptInvite', roomId: pending.id })}>接受</button>}
        {pending.onThisDevice
          ? <button className="link" disabled={busy} onClick={() => change({ action: 'leave', roomId: pending.id })}>{incoming ? '拒绝' : '取消邀请'}</button>
          : <small className="sub">邀请由另一台设备发出</small>}
      </section>
    );
  }

  if (!inviting) return null;
  return (
    <form className="player-together together-invite" aria-label="邀请好友一起听" onSubmit={e => {
      e.preventDefault(); if (selected) change({ action: 'invite', peerId: selected.id });
    }}>
      <FriendPicker friends={friends} selected={selected} onSelect={person => setPeerId(String(person.id))} />
      <button className="btn sm" disabled={!selected || busy}>邀请一起听</button>
      <button type="button" className="ib" aria-label="关闭邀请" onClick={onClose}><Icon n="x" s={15} /></button>
    </form>
  );
}

function FriendPicker({ friends, selected, onSelect }: { friends: Person[]; selected?: Person; onSelect: (person: Person) => void }) {
  const [open, setOpen] = useState(false);
  const control = useRef<HTMLButtonElement>(null);
  const listId = useId();

  function dismiss() {
    setOpen(false);
    control.current?.focus();
  }

  return (
    <div className="friend-picker" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={e => {
      if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); dismiss(); }
    }}>
      <button type="button" className="friend-picker-control" ref={control} disabled={!friends.length} aria-label={selected ? `选择好友，当前${selected.name}` : '选择好友'}
        aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(value => !value)}>
        {selected ? <Avatar src={selected.avatar} name={selected.name} /> : <Icon n="users" s={16} />}
        <span className="t1">{selected?.name ?? (friends.length ? '选择好友' : '还没有好友')}</span><Icon n="down" s={15} />
      </button>
      {open && (
        <div className="friend-picker-options" id={listId} role="group" aria-label="好友">
          {friends.map(friend => (
            <button type="button" key={friend.id} className={friend.id === selected?.id ? 'on' : ''} aria-pressed={friend.id === selected?.id}
              onClick={() => { onSelect(friend); dismiss(); }}>
              <Avatar src={friend.avatar} name={friend.name} /><span className="t1">{friend.name}</span>
              {friend.id === selected?.id && <Icon n="check" s={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
