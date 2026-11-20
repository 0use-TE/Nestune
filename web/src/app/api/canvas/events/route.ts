import { canvasEventStream } from '@/server/canvas-events';
import { canvasSyncToken } from '@/server/canvas-sync';
import { now, one } from '@/server/db';
import { userRoute } from '@/server/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = userRoute((req, _ctx, user, sessionId) => canvasEventStream(req.signal, user.id, () => !!one(`
  SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
  WHERE s.id=? AND s.kind='user' AND s.expires_at>=? AND u.status='active'
`, sessionId, now()), canvasSyncToken), { bucket: 'canvas-events' });
