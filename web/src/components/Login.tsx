'use client';
import { useState } from 'react';
import { post } from '@/lib/api';
import { useApp } from '@/lib/app';

export function Login() {
  const app = useApp();
  const [mode, setMode] = useState<'login' | 'activate'>('login');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const act = mode === 'activate';

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const username = String(f.get('u') || '').trim();
    setErr('');
    if (act && f.get('p') !== f.get('p2')) { setErr('两次输入的密码不一致'); return; }
    setBusy(true);
    try {
      if (act) await post('/api/auth/activate', { username, code: f.get('c'), password: f.get('p') });
      else await post('/api/auth/login', { username, password: f.get('p') });
      await app.loadSession();
      app.toast(act ? '密码已设置，欢迎' : '欢迎回来');
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div id="login">
      <div className="lart">
        <i style={{ width: 520, height: 520, background: '#f2b84b', left: -120, top: -100, opacity: .9 }} />
        <i style={{ width: 380, height: 380, background: '#1f3a4d', right: -80, bottom: -60, opacity: .85 }} />
        <i style={{ width: 200, height: 200, background: '#fbe3c4', right: 120, top: 140, opacity: .95 }} />
      </div>
      <div className="lform">
        <div className="lbox">
          <div className="brand" style={{ padding: 0 }}><span className="logo" />Nestune</div>
          <h1 style={{ marginTop: 34 }}>{act ? '设置你的密码' : '欢迎回来'}</h1>
          <div className="sub" style={{ marginTop: 6 }}>{act ? '使用管理员发给你的激活码首次登录' : '登录你的私人音乐库'}</div>
          <form onSubmit={submit} key={mode}>
            <div className="field"><label className="sm sub">用户名</label><input name="u" autoComplete="username" required autoFocus /></div>
            {act ? (
              <>
                <div className="field"><label className="sm sub">激活码</label><input name="c" placeholder="XXXX-XXXX-XXXX" required autoComplete="off" /></div>
                <div className="field"><label className="sm sub">新密码</label><input name="p" type="password" required minLength={8} placeholder="至少 8 位，包含字母和数字" autoComplete="new-password" /></div>
                <div className="field"><label className="sm sub">确认密码</label><input name="p2" type="password" required autoComplete="new-password" /></div>
              </>
            ) : (
              <div className="field"><label className="sm sub">密码</label><input name="p" type="password" required autoComplete="current-password" /></div>
            )}
            {err && <div className="err">{err}</div>}
            <button className="btn" type="submit" disabled={busy}>{busy ? '请稍候…' : act ? '设置密码并进入' : '登录'}</button>
          </form>
          <button className="link" style={{ marginTop: 20 }} onClick={() => { setErr(''); setMode(act ? 'login' : 'activate'); }}>
            {act ? '已有密码？返回登录' : '收到激活码？首次登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
