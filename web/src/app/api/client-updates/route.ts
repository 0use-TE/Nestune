import { androidRelease } from '@/server/client-updates';
import { json } from '@/server/http';
export const dynamic = 'force-dynamic';
export function GET() { return json({ version: '1.0.0', android: androidRelease() }); }
