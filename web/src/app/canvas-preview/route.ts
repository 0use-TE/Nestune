import { NextRequest, NextResponse } from 'next/server';
export function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development' || process.env.NESTUNE_CANVAS_PREVIEW !== '1' || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.get('host') || '')) return new NextResponse(null, { status: 404 });
  const token = process.env.NESTUNE_CANVAS_PREVIEW_TOKEN;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return new NextResponse(null, { status: 404 });
  const response = NextResponse.redirect(new URL('/square', 'http://' + req.headers.get('host')));
  response.cookies.set('nt_sid', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 86400 });
  return response;
}
