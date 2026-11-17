import { RELEASE_NOTES } from '@/lib/release-notes';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

export function GET() {
  return json({ releases: RELEASE_NOTES }, 200, { 'Cache-Control': 'no-store' });
}
