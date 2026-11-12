import { userRoute } from '@/server/guard';
import { intParam, str } from '@/server/http';
import { withSlot } from '@/server/ratelimit';
import { myUploads, saveUpload, searchUploads, uploadForm } from '@/server/uploads';

export const GET = userRoute((req, _ctx, user) => {
  const params = req.nextUrl.searchParams;
  if (params.get('scope') === 'mine') return { uploads: myUploads(user.id) };
  return searchUploads(user.id, str(params.get('q'), 0, 100, '关键词'),
    intParam(params.get('limit'), 30, 100), intParam(params.get('offset'), 0, 1_000_000));
}, { bucket: 'uploads' });

export const POST = userRoute((req, _ctx, user) => withSlot('upload-writes', 2, async () => ({
  upload: await saveUpload(user.id, await uploadForm(req)),
})), { bucket: 'uploads' });
