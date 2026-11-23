import { now, one } from '@/server/db';
import { userRoute } from '@/server/guard';
import { listeningEventStream } from '@/server/listening-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = userRoute((req, _ctx, user, sessionId) => listeningEventStream(req.signal, user.id, () => !!one(`
  SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
  WHERE s.id=? AND s.kind='user' AND s.expires_at>=? AND u.status='active'
`, sessionId, now())), { bucket: 'listening-events' });
