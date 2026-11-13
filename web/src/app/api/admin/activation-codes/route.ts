import { body } from '@/server/http';
import { adminRoute } from '@/server/guard';
import { createActivationCode, listActivationCodes } from '@/server/users';

export const GET = adminRoute(() => ({ codes: listActivationCodes() }));
export const POST = adminRoute(async req => createActivationCode(await body<{ maxQuality?: string }>(req)));
