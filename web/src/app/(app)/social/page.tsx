'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import FriendsChats from '@/components/FriendsChats';
import UsersDirectory from '@/components/UsersDirectory';
import { Loading } from '@/components/Loading';
import { GuideHelp } from '@/components/UsageGuide';
import { MotionTabs } from '@/components/MotionTabs';
import { Domains, domainListHref } from '@/components/Domains';

const tabs = [
  ['friends', '好友', '/social'],
  ['users', '所有用户', '/social?tab=users'],
  ['domains', '域', domainListHref],
] as const;

export default function SocialPage() { return <Suspense fallback={<Loading />}><Together /></Suspense>; }

function Together() {
  const params = useSearchParams();
  const tab = params.get('tab');
  const domain = Number(params.get('domain'));
  const domainId = tab === 'domains' && Number.isSafeInteger(domain) && domain > 0 ? domain : null;
  return <div className="chat-page together-page">
    {!domainId && <>
      <div className="together-heading"><h1>一起听</h1><GuideHelp topic="social">使用提示</GuideHelp></div>
      <MotionTabs label="一起听分类" selected={tab || 'friends'} className="together-tabs">
        {tabs.map(([key, label, href]) => {
          const selected = key === 'friends' ? tab !== 'users' && tab !== 'domains' : tab === key;
          return <Link key={key} className={`tab ${selected ? 'on' : ''}`} href={href} replace scroll={false} aria-current={selected ? 'page' : undefined}>{label}</Link>;
        })}
      </MotionTabs>
    </>}
    <div className="together-content" data-transition-content>
      {tab === 'domains' ? <Domains domainId={domainId} /> : tab === 'users' ? <div className="together-users"><UsersDirectory /></div> : <FriendsChats />}
    </div>
  </div>;
}
