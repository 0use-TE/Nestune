'use client';
import { Loading } from '@/components/Loading';
import { useEffect, useRef, useState } from 'react';
import { api, del, get, patch, post } from '@/lib/api';
import { useApp } from '@/lib/app';
import { useSocial } from '@/lib/social';
import { QUALITY_LABEL, fmtDate, fmtDateTime } from '@/lib/util';
import { Avatar } from '@/components/Cover';
import { Icon } from '@/components/Icon';
import { AvatarCrop } from '@/components/AvatarCrop';
import { ManageUploads } from '@/components/ManageUploads';
import { PwaInstall } from '@/components/Pwa';

const SECTIONS = ['资料', '我的上传', '偏好', '账号与安全'] as const;

export default function SettingsPage() {
  const app = useApp();
  const social = useSocial();
  const me = app.me!;
  const file = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('资料');
  const [plays, setPlays] = useState<number | null>(null);
  const [name, setName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [email, setEmail] = useState(me.email);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwErr, setPwErr] = useState('');
  const [savingVisibility, setSavingVisibility] = useState(false);

  useEffect(() => { get('/api/me').then(r => setPlays(r.stats.plays)).catch(() => {}); }, []);
  const dirty = name !== me.displayName || bio !== me.bio || email !== me.email;

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await patch('/api/me', { displayName: name, bio, email }); app.setMe(r.user); app.toast('资料已保存'); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  async function upload(blob: Blob) {
    const fd = new FormData(); fd.append('file', blob, 'avatar.png');
    const r = await api('/api/me/avatar', { method: 'POST', body: fd });
    app.setMe(r.user); setCropFile(null); app.toast('头像已更新');
  }
  async function removeAvatar() {
    try { const r = await del('/api/me/avatar'); app.setMe(r.user); app.toast('已移除头像'); } catch (e: any) { app.toast(e.message); }
  }
  async function changePw(e: React.FormEvent) {
    e.preventDefault(); setPwErr('');
    if (pw.next !== pw.again) { setPwErr('两次输入的新密码不一致'); return; }
    try { await post('/api/me/password', { current: pw.current, next: pw.next }); setPw({ current: '', next: '', again: '' }); app.toast('密码已修改，其他设备已下线'); }
    catch (e: any) { setPwErr(e.message); }
  }
  async function toggleVisibility() {
    if (!social.state) return;
    setSavingVisibility(true);
    try { await social.action({ action: 'visibility', visible: !social.state.showOnline }); }
    catch (e) { app.toast(e instanceof Error ? e.message : '无法保存在线状态设置'); }
    finally { setSavingVisibility(false); }
  }

  return (
    <div className="settings-page">
      <h1>个人设置</h1>
      <div className="tabs" role="group" aria-label="个人设置">
        {SECTIONS.map(label => (
          <button key={label} className={`tab ${section === label ? 'on' : ''}`} aria-pressed={section === label} onClick={() => setSection(label)}>{label}</button>
        ))}
      </div>

      {section === '我的上传' && <ManageUploads />}

      {section === '资料' && (
        <section className="panel pad" aria-label="资料">
          <div className="settings-profile">
            <Avatar src={me.avatar} name={me.displayName} large />
            <div className="settings-identity">
              <h2>{me.displayName}</h2>
              <div className="sub t1">@{me.username}</div>
            </div>
            <div className="row">
              <button className="btn ghost sm" onClick={() => file.current?.click()} title="支持 PNG、JPG、WebP"><Icon n="camera" s={15} />更换头像</button>
              {me.avatar && <button className="link" onClick={removeAvatar}>移除头像</button>}
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => {
                const picked = e.target.files?.[0]; e.target.value = '';
                if (picked) setCropFile(picked);
              }} />
            </div>
          </div>
          <form onSubmit={saveProfile}>
            <div className="settings-fields">
              <label className="field sm sub">昵称<input value={name} onChange={e => setName(e.target.value)} maxLength={24} required /></label>
              <label className="field sm sub">邮箱（选填，仅自己可见）<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label>
            </div>
            <label className="field sm sub">个人简介<textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={140} rows={3} placeholder="介绍一下自己，最多 140 字" /></label>
            {err && <div className="err" role="alert">{err}</div>}
            <div className="settings-save"><button className="btn sm" disabled={busy || !dirty}>{busy ? <Loading inline label="保存中" /> : '保存资料'}</button></div>
          </form>
        </section>
      )}

      {section === '偏好' && (
        <section className="panel" aria-label="偏好">
          <PwaInstall />
          <div className="set">
            <b>外观</b>
            <div className="row" role="group" aria-label="外观">{([['auto', '自动'], ['light', '浅色'], ['dark', '深色']] as const).map(([k, l]) => <button key={k} className={`chip ${app.theme === k ? 'on' : ''}`} aria-pressed={app.theme === k} onClick={() => app.setTheme(k)}>{l}</button>)}</div>
          </div>
          <div className="set">
            <b>显示歌词翻译</b>
            <button className={`switch ${app.showTr ? 'on' : ''}`} role="switch" aria-label="显示歌词翻译" aria-checked={app.showTr} onClick={() => app.setShowTr(!app.showTr)} />
          </div>
          <div className="set">
            <div><b>显示在线状态</b><div className="sub sm">在「一起听」公开在线状态和正在听的歌曲</div></div>
            <button className={`switch ${social.state?.showOnline ? 'on' : ''}`} role="switch" aria-label="显示在线状态"
              aria-checked={social.state?.showOnline ?? false} disabled={!social.state || savingVisibility} onClick={toggleVisibility} />
          </div>
          {([['messageToast', '新消息弹窗'], ['messageSound', '新消息提示音'], ['inviteToast', '一起听邀请弹窗']] as const).map(([key, label]) => (
            <div className="set" key={key}>
              <b>{label}</b><button className={`switch ${social.notices[key] ? 'on' : ''}`} role="switch" aria-label={label}
                aria-checked={social.notices[key]} onClick={() => social.setNotice(key, !social.notices[key])} />
            </div>
          ))}
        </section>
      )}
      {cropFile && <AvatarCrop file={cropFile} onCancel={() => setCropFile(null)} onSave={upload} />}

      {section === '账号与安全' && (
        <section className="settings-account" aria-label="账号与安全">
          <dl className="panel">
            <div className="set"><dt>最高音质</dt><dd>{QUALITY_LABEL[me.maxQuality] || me.maxQuality}</dd></div>
            <div className="set"><dt>收藏歌曲</dt><dd>{app.favIds.size}</dd></div>
            <div className="set"><dt>播放次数</dt><dd>{plays ?? '—'}</dd></div>
            <div className="set"><dt>加入时间</dt><dd>{fmtDate(me.createdAt)}</dd></div>
            <div className="set"><dt>上次登录</dt><dd>{fmtDateTime(me.lastLoginAt)}</dd></div>
          </dl>
          <details className="panel pad settings-password">
            <summary>修改密码</summary>
            <form onSubmit={changePw}>
              <label className="field sm sub">当前密码<input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required /></label>
              <label className="field sm sub">新密码<input type="password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} minLength={8} placeholder="至少 8 位，包含字母和数字" autoComplete="new-password" required /></label>
              <label className="field sm sub">确认新密码<input type="password" value={pw.again} onChange={e => setPw({ ...pw, again: e.target.value })} autoComplete="new-password" required /></label>
              {pwErr && <div className="err" role="alert">{pwErr}</div>}
              <div className="row"><button className="btn sm">修改密码</button><span className="sub sm">修改后其他设备会下线</span></div>
            </form>
          </details>
          <button className="btn ghost sm settings-logout" onClick={app.logout}><Icon n="out" s={15} />退出登录</button>
        </section>
      )}
    </div>
  );
}
