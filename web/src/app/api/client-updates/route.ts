import { androidRelease, windowsRelease } from '@/server/client-updates';
import { VERSION } from '@/lib/version';
import { json } from '@/server/http';
export const dynamic = 'force-dynamic';
export function GET() { return json({ version: VERSION, android: androidRelease(), windows: windowsRelease() }); }
