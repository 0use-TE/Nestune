'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { del, get, post } from '@/lib/api';

export function QqSourceAdmin({ guard, toast }: { guard: (e: any) => void; toast: (s: string) => void }) {
  const [status, setStatus] = useState<any>(null);
  const [qr, setQr] = useState<{ img: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useCallback(() => get('/api/admin/qqmusic').then(setStatus).catch(guard), [guard]);
  useEffect(() => { load(); return () => { generation.current++; clearTimeout(timer.current); }; }, [load]);
  async function start(type: 'qq' | 'wx') {
    const run = ++generation.current; clearTimeout(timer.current); setBusy(true);
    try {
      const r = await post(`/api/admin/qqmusic?type=${type}`);
      if (run !== generation.current) return;
      setQr({ img: r.qrimg, message: type === 'qq' ? '请使用 QQ 扫码，在手机上确认登录' : '请使用微信扫码，在手机上确认登录' });
      const poll = async () => {
        try {
          const c = await get(`/api/admin/qqmusic/check?key=${encodeURIComponent(r.key)}`);
          if (run !== generation.current) return;
          if (c.loggedIn) { setQr(null); toast('QQ 音乐已登录'); load(); return; }
          if (c.code === 800) { setQr(q => q && { ...q, message: '二维码已失效，请重新生成' }); return; }
          if (c.code === 802) setQr(q => q && { ...q, message: '已扫码，请在手机上确认登录' });
          timer.current = setTimeout(poll, 2500);
        } catch (e) { if (run === generation.current) { setQr(null); guard(e); } }
      };
      timer.current = setTimeout(poll, 2500);
    } catch (e) { guard(e); } finally { setBusy(false); }
  }
  async function logout() {
    generation.current++; clearTimeout(timer.current); setQr(null);
    try { await del('/api/admin/qqmusic'); toast('QQ 音乐已退出'); load(); } catch (e) { guard(e); }
  }
  return <div className="box pad" style={{ marginTop: 20 }}>
    <h2>QQ 音乐</h2>
    <p className="sub" style={{ margin: '8px 0 16px' }}>{!status ? '正在读取状态…' : !status.configured ? '尚未配置 QQ 音乐服务' : status.loggedIn ? '已登录' : status.unreachable ? '暂时无法验证登录，请检查 QQ 音乐服务' : status.expired ? '登录已失效，请重新扫码' : '未登录'}</p>
    {qr && <><div className="qr"><img src={qr.img} alt="QQ 音乐登录二维码" /></div><p className="sub">{qr.message}</p></>}
    {status?.configured && <div className="row"><button className="btn" disabled={busy} onClick={() => start('qq')}>QQ 扫码登录</button><button className="btn ghost" disabled={busy} onClick={() => start('wx')}>微信扫码登录</button>{status.loggedIn && <button className="btn ghost" onClick={logout}>退出 QQ 音乐</button>}</div>}
    <p className="sub sm" style={{ marginTop: 14 }}>歌曲是否能完整播放，以此 QQ 音乐账号的实际权限为准。QQ 音乐暂只提供在线播放。</p>
  </div>;
}
