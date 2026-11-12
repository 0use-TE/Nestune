import { VERSION } from '@/server/config';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

export function GET() {
  return json({ version: VERSION, build: process.env.BUILD_ID || 'dev' });
}
