'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import FriendsChats from '@/components/FriendsChats';
import UsersDirectory from '@/components/UsersDirectory';
import { Loading } from '@/components/Loading';

export default function SocialPage(){return <Suspense fallback={<Loading/>}><Together/></Suspense>;}
function Together(){
  const params=useSearchParams();const users=params.get('tab')==='users';
  return <div className="chat-page together-page">
    <h1>一起听</h1>
    <nav className="tabs together-tabs" aria-label="一起听分类">
      <Link className={`tab ${users?'':'on'}`} href="/social" replace scroll={false} aria-current={!users?'page':undefined}>好友</Link>
      <Link className={`tab ${users?'on':''}`} href="/social?tab=users" replace scroll={false} aria-current={users?'page':undefined}>所有用户</Link>
    </nav>
    {users?<div className="together-users"><UsersDirectory/></div>:<FriendsChats/>}
  </div>;
}
