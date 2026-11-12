import { adminRoute } from '@/server/guard';
import { listLibrary } from '@/server/library';

export const GET = adminRoute(() => ({ songs: listLibrary() }));
