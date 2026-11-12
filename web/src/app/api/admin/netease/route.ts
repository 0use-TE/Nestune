import { adminRoute } from '@/server/guard';
import { logout, qrCreate, status } from '@/server/netease';

export const GET = adminRoute(() => status());
export const POST = adminRoute(() => qrCreate());
export const DELETE = adminRoute(() => { logout(); return { ok: true }; });
