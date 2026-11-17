import { androidRelease, windowsRelease } from '@/server/client-updates';
import { VERSION } from '@/lib/version';
import { json } from '@/server/http';
export const dynamic = 'force-dynamic';
export function GET(req: Request) { return json({ version: VERSION, android: androidRelease(), windows: windowsRelease(new URL(req.url).searchParams.get('windows_arch') === 'arm64' ? 'arm64' : 'x64') }); }
