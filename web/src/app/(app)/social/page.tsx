'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import FriendsChats from '@/components/FriendsChats';
import UsersDirectory from '@/components/UsersDirectory';
import { Loading } from '@/components/Loading';
import { GuideHelp } from '@/components/UsageGuide';
import { ListeningRoomChat, ListeningRoomControls } from '@/components/ListeningRoom';
import { PlayerTogether } from '@/components/PlayerTogether';
import { useApp } from '@/lib/app';
import { useSocial } from '@/lib/social';

export default function SocialPage(){return <Suspense fallback={<Loading/>}><Together/></Suspense>;}
function Together(){
  const params=useSearchParams();const users=params.get('tab')==='users';
  const { me, toast } = useApp();
  const { state, action } = useSocial();
  const [busy, setBusy] = useState(false);
  const room = state?.rooms.find(item => item.active);
  const groupRoom = room?.group ? room : null;
  const pending = state?.rooms.some(item => !item.active && item.inviteId);
  async function createRoom() {
    setBusy(true);
    try { await action({ action: 'createRoom' }); }
    catch (error) { toast(error instanceof Error ? error.message : '创建房间失败'); }
    finally { setBusy(false); }
  }
  return <div className="chat-page together-page">
    <div className="together-heading"><h1>一起听</h1><div className="row">
      {!room && <button type="button" className="btn sm" disabled={busy} onClick={() => void createRoom()}>创建房间</button>}
      <GuideHelp topic="social">使用提示</GuideHelp>
    </div></div>
    {groupRoom && <div className="listening-room-page">
      <ListeningRoomControls key={groupRoom.id} room={groupRoom} />
      <ListeningRoomChat key={groupRoom.id} room={groupRoom} />
    </div>}
    {me && !groupRoom && (pending || room && !room.onThisDevice) && <PlayerTogether inviting={false} onClose={() => {}} active={null} />}
    <nav className="tabs together-tabs" aria-label="一起听分类">
      <Link className={`tab ${users?'':'on'}`} href="/social" replace scroll={false} aria-current={!users?'page':undefined}>好友</Link>
      <Link className={`tab ${users?'on':''}`} href="/social?tab=users" replace scroll={false} aria-current={users?'page':undefined}>所有用户</Link>
    </nav>
    {users?<div className="together-users"><UsersDirectory/></div>:<FriendsChats/>}
  </div>;
}
