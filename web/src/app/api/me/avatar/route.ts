import { publicUser } from '@/server/auth';
import { MAX_AVATAR, removeAvatar, saveAvatar } from '@/server/avatar';
import { fail } from '@/server/http';
import { userRoute } from '@/server/guard';
import { byId } from '@/server/users';

export const POST = userRoute(async (req, _ctx, u) => {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_AVATAR + 4096) throw fail(413, '头像不能超过 2 MB');
  let form: FormData;
  try { form = await req.formData(); } catch { throw fail(400, '请使用表单上传图片'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw fail(400, '没有收到图片');
  saveAvatar(u, Buffer.from(await file.arrayBuffer()));
  return { user: publicUser(byId(u.id)!) };
});

export const DELETE = userRoute(async (_req, _ctx, u) => {
  removeAvatar(u);
  return { user: publicUser(byId(u.id)!) };
});
