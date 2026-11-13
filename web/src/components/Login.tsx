'use client';
import { Loading } from './Loading';
import { useState } from 'react';
import { post } from '@/lib/api';
import { useApp } from '@/lib/app';
import { Icon } from './Icon';

export function Login() {
  const app = useApp();
  const [mode, setMode] = useState<'login' | 'activate'>('login');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [invitation, setInvitation] = useState<null | { code: string; kind: 'register' | 'reset'; username?: string }>(null);
  const act = mode === 'activate';

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const username = String(f.get('u') || '').trim();
    setErr('');
    if (act && !invitation) {
      setBusy(true);
      try {
        const code = String(f.get('c') || '').trim();
        const checked = await post('/api/auth/activate/check', { code });
        setInvitation({ ...checked, code });
      } catch (e: any) { setErr(e.message); }
      setBusy(false);
      return;
    }
    if (act && f.get('p') !== f.get('p2')) { setErr('两次输入的密码不一致'); return; }
    setBusy(true);
    try {
      if (act) await post('/api/auth/activate', { username, code: invitation!.code, displayName: f.get('nickname'), password: f.get('p') });
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
          <h1 style={{ marginTop: 34 }}>{act ? !invitation ? '激活账号' : invitation.kind === 'register' ? '创建你的账号' : '设置新密码' : '欢迎回来'}</h1>
          <div className="sub" style={{ marginTop: 6 }}>{act ? !invitation ? '输入管理员发给你的激活码' : invitation.kind === 'register' ? '设置用户名、昵称和密码' : '为你的账号设置新密码' : '登录你的私人音乐库'}</div>
          <form onSubmit={submit} key={`${mode}-${!!invitation}`}>
            {act && !invitation ? <div className="field"><label htmlFor="activation-code" className="sm sub">激活码</label><input id="activation-code" name="c" placeholder="XXXX-XXXX-XXXX" required autoFocus autoComplete="off" maxLength={32} /></div> : <>
            <div className="field"><label htmlFor="login-username" className="sm sub">用户名</label><input id="login-username" name="u" autoComplete="username" required autoFocus defaultValue={invitation?.username} readOnly={act && invitation?.kind === 'reset'} pattern={act ? '[A-Za-z0-9_]{3,24}' : undefined} maxLength={24} placeholder={act ? '3–24 位字母、数字或下划线' : undefined} /></div>
            {act ? (
              <>
                {invitation?.kind === 'register' && <div className="field"><label htmlFor="activation-nickname" className="sm sub">昵称</label><input id="activation-nickname" name="nickname" required maxLength={24} autoComplete="nickname" /></div>}
                <div className="field"><label htmlFor="login-password" className="sm sub">新密码</label><input id="login-password" name="p" type="password" required minLength={8} maxLength={128} placeholder="至少 8 位，包含字母和数字" autoComplete="new-password" /></div>
                <div className="field"><label htmlFor="confirm-password" className="sm sub">确认密码</label><input id="confirm-password" name="p2" type="password" required maxLength={128} autoComplete="new-password" /></div>
              </>
            ) : (
              <div className="field"><label className="sm sub">密码</label><input name="p" type="password" required autoComplete="current-password" /></div>
            )}</>}
            {err && <div className="err">{err}</div>}
            <button className="btn" type="submit" disabled={busy}>{busy ? <Loading inline label="请稍候" /> : act ? !invitation ? '下一步' : invitation.kind === 'register' ? '创建账号并进入' : '设置密码并进入' : '登录'}</button>
            {act && invitation && <button className="btn ghost" type="button" disabled={busy} style={{ marginTop: 10, width: '100%', justifyContent: 'center' }} onClick={() => { setInvitation(null); setErr(''); }}>更换激活码</button>}
          </form>
          <div className="login-alternative">
            <p className="sub sm">{act ? '已经激活过账号？' : '首次登录？使用管理员发给你的激活码。'}</p>
            <button type="button" className="btn ghost login-switch" disabled={busy}
              onClick={() => { setErr(''); setInvitation(null); setMode(act ? 'login' : 'activate'); }}>
              <Icon n={act ? 'back' : 'user'} s={17} />{act ? '返回登录' : '激活账号'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
