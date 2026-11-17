import { notFound } from 'next/navigation';
import { AboutNestune } from '@/components/Pwa';
export const dynamic = 'force-dynamic';
export default function Page() {
  if (process.env.NODE_ENV === 'production' || process.env.NESTUNE_UPDATE_PREVIEW !== '1') notFound();
  return <main style={{ maxWidth: 720, margin: '40px auto', padding: 20 }}><AboutNestune /></main>;
}
