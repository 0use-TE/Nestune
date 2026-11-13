'use client';
import Link, { useLinkStatus } from 'next/link';
import { Loading } from './Loading';

function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="playlist-opening"><Loading inline label="正在打开歌单" /></span> : null;
}

export function PlaylistLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="panel playlist-card">{children}<Pending /></Link>;
}
