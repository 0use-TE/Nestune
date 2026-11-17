import { userRoute } from '@/server/guard';
import { fail } from '@/server/http';
import { addCanvasImage, CANVAS_IMAGE_MAX } from '@/server/canvas';

export const runtime = 'nodejs';
const upload = async (req: Request, owner: number) => {
  if (!req.body) throw fail(400, '没有收到图片');
  const limit = CANVAS_IMAGE_MAX + 8192;
  if (Number(req.headers.get('content-length')) > limit) throw fail(413, '图片不能超过 3 MB');
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.length;
    if (length > limit) { await reader.cancel(); throw fail(413, '图片不能超过 3 MB'); }
    chunks.push(part.value);
  }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': req.headers.get('content-type') || '' } }).formData(); }
  catch { throw fail(400, '图片表单无效'); }
  const file = form.get('file'); if (!(file instanceof File)) throw fail(400, '请选择图片');
  return addCanvasImage(owner, Buffer.from(await file.arrayBuffer()), { x: Number(form.get('x') ?? 500), y: Number(form.get('y') ?? 300) });
};
export const POST = userRoute((req, _ctx, user) => upload(req, user.id));
