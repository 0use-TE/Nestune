import { notFound } from 'next/navigation';
import { LyricsPreview } from './preview';
import './preview.css';

export const dynamic = 'force-dynamic';
export default function Page() {
  if (process.env.NESTUNE_LYRICS_PREVIEW !== '1') notFound();
  return <LyricsPreview />;
}
