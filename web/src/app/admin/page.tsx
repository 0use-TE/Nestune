'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { del, get, patch, post } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { QUALITY_LABEL, fmtBytes, fmtDateTime } from '@/lib/util';

type Toast = (m: string) => void;
const TABS = [['overview', '概览', 'dash'], ['users', '用户', 'users'], ['source', '音源账号', 'cloud'], ['storage', '缓存与本地库', 'disk'], ['jobs', '转换任务', 'task'], ['system', '系统设置', 'set']] as const;
type Tab = (typeof TABS)[number][0];

export default function AdminPage() {
  const [state, setState] = useState<'loading' | 'unconfigured' | 'locked' | 'open'>('loading');
  const [toasts, setToasts] = useState<{ id: number; t: string }[]>([]);
  const toast: Toast = useCallback(t => {
    const id = Date.now() + Math.random();
    setToasts(x => [...x, { id, t }]); setTimeout(() => setToasts(x => x.filter(y => y.id !== id)), 2400);
  }, []);

  useEffect(() => {
    get('/api/admin/session').then(r => setState(!r.configured ? 'unconfigured' : r.admin ? 'open' : 'locked')).catch(() => setState('locked'));
  }, []);

  return (
    <>
      {state === 'loading' && <div className="center sub" style={{ paddingTop: '30vh' }}>加载中…</div>}
      {state === 'unconfigured' && (
        <div className="adm-login"><div className="lbox">
          <h2>管理后台尚未启用</h2>
          <p className="sub" style={{ marginTop: 10 }}>服务端没有配置管理密钥。请在服务器环境变量中设置 <code>ADMIN_KEY</code>（至少 32 个字符），然后重启服务。</p>
        </div></div>
      )}
      {state === 'locked' && <KeyLogin onDone={() => setState('open')} />}
      {state === 'open' && <Panel toast={toast} onLock={() => setState('locked')} />}
      <div className="toasts">{toasts.map(t => <div key={t.id} className="toast">{t.t}</div>)}</div>
    </>
  );
}

function KeyLogin({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post('/api/admin/login', { key }); onDone(); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <div className="adm-login">
      <form className="lbox" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><span className="logo" />Nestune</div>
        <div className="sub sm" style={{ margin: '6px 0 24px', letterSpacing: '.06em', fontWeight: 600 }}>管理后台</div>
        <div className="field"><label className="sm sub">管理密钥</label><input type="password" value={key} onChange={e => setKey(e.target.value)} autoFocus autoComplete="off" required placeholder="服务端环境变量 ADMIN_KEY" /></div>
        {err && <div className="err">{err}</div>}
        <button className="btn" style={{ width: '100%', justifyContent: 'center', padding: 12 }} disabled={busy || !key}>{busy ? '验证中…' : '进入后台'}</button>
        <p className="muted sm" style={{ marginTop: 16 }}>后台没有账号体系，只能使用服务器上配置的管理密钥进入。</p>
      </form>
    </div>
  );
}

function Panel({ toast, onLock }: { toast: Toast; onLock: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  async function lock() { await post('/api/admin/logout').catch(() => {}); onLock(); }
  const guard = useCallback((e: any) => { if (e?.status === 401) onLock(); else toast(e?.message || '操作失败'); }, [onLock, toast]);
  return (
    <div className="adm-shell">
      <aside>
        <div className="brand"><span className="logo" />Nestune</div>
        <div className="badge">管理后台</div>
        {TABS.map(([k, label, icon]) => <button key={k} className={`nav ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}><Icon n={icon} s={18} />{label}</button>)}
        <div className="sp" />
        <button className="nav" onClick={lock}><Icon n="out" s={18} />锁定后台</button>
      </aside>
      <main>
        {tab === 'overview' && <Overview guard={guard} go={setTab} />}
        {tab === 'users' && <Users guard={guard} toast={toast} />}
        {tab === 'source' && <Source guard={guard} toast={toast} />}
        {tab === 'storage' && <Storage guard={guard} toast={toast} />}
        {tab === 'jobs' && <Jobs guard={guard} toast={toast} />}
        {tab === 'system' && <System guard={guard} toast={toast} />}
      </main>
    </div>
  );
}
type P = { guard: (e: any) => void; toast: Toast };

const Pill = ({ children, kind = '' }: { children: React.ReactNode; kind?: string }) => <span className={`pill ${kind}`}>{children}</span>;
const uptime = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)} 天` : s >= 3600 ? `${Math.floor(s / 3600)} 小时` : `${Math.max(1, Math.floor(s / 60))} 分钟`);

/* ---------------- overview ---------------- */
function Overview({ guard, go }: { guard: P['guard']; go: (t: Tab) => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { get('/api/admin/overview').then(setD).catch(guard); }, [guard]);
  if (!d) return <div className="center sub">加载中…</div>;
  const todo: [string, Tab][] = [];
  if (d.users.pending) todo.push([`${d.users.pending} 个用户尚未完成首次登录`, 'users']);
  if (!d.source.loggedIn) todo.push([d.source.expired ? '音源登录已失效，需要重新扫码' : '音源账号尚未登录', 'source']);
  if (d.worker.configured && !d.worker.ok) todo.push(['无法连接 audio-worker', 'jobs']);
  if (!d.worker.configured) todo.push(['尚未配置 audio-worker', 'jobs']);
  return (
    <>
      <div className="head"><div><h1>概览</h1><div className="sub">版本 {d.version} · 已运行 {uptime(d.uptimeSeconds)}</div></div></div>
      <div className="stats">
        <div className="stat"><span className="sub sm">用户</span><b>{d.users.total}</b><span className="muted sm">{d.users.active} 正常 · {d.users.pending} 待激活 · {d.users.disabled} 停用</span></div>
        <div className="stat"><span className="sub sm">当前在线</span><b>{d.users.online}</b></div>
        <div className="stat"><span className="sub sm">今日播放</span><b>{d.playsToday}</b></div>
        <div className="stat"><span className="sub sm">本地库</span><b>{d.library.songs} 首</b><span className="muted sm">{fmtBytes(d.library.bytes)}</span></div>
        <div className="stat"><span className="sub sm">缓存</span><b>{fmtBytes(d.cache.bytes)}</b><div className="bar"><i style={{ width: `${Math.min(100, (d.cache.bytes / d.cache.limitBytes) * 100)}%` }} /></div></div>
      </div>
      <div className="box">
        <table>
          <thead><tr><th>服务</th><th>状态</th><th /></tr></thead>
          <tbody>
            <tr><td>音源账号</td><td>{d.source.loggedIn ? <Pill kind="ok">已登录</Pill> : <Pill kind="bad">{d.source.expired ? '已失效' : '未登录'}</Pill>}</td><td style={{ textAlign: 'right' }}><button className="btn ghost sm" onClick={() => go('source')}>管理</button></td></tr>
            <tr><td>audio-worker</td><td>{!d.worker.configured ? <Pill>未配置</Pill> : d.worker.ok ? <Pill kind="ok">运行中</Pill> : <Pill kind="bad">无法连接</Pill>}</td><td style={{ textAlign: 'right' }}><button className="btn ghost sm" onClick={() => go('jobs')}>查看</button></td></tr>
          </tbody>
        </table>
      </div>
      <div className="box">
        <table><thead><tr><th>需要关注</th></tr></thead><tbody>
          {todo.length ? todo.map(([t, tab]) => <tr key={t}><td style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{t}<button className="btn ghost sm" onClick={() => go(tab)}>去处理</button></td></tr>) : <tr><td className="sub">一切正常，没有需要处理的事项。</td></tr>}
        </tbody></table>
      </div>
    </>
  );
}

/* ---------------- users ---------------- */
type U = { id: number; username: string; displayName: string; status: string; maxQuality: string; createdAt: number; lastLoginAt: number; favorites: number; plays: number };
function Users({ guard, toast }: P) {
  const [users, setUsers] = useState<U[] | null>(null);
  const [form, setForm] = useState<null | { username: string; displayName: string; maxQuality: string }>(null);
  const [reveal, setReveal] = useState<null | { title: string; code: string }>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => get('/api/admin/users').then(r => setUsers(r.users)).catch(guard), [guard]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try { const r = await post('/api/admin/users', form); setForm(null); setReveal({ title: `已创建：${r.user.username}`, code: r.activationCode }); load(); }
    catch (e: any) { setErr(e.message); }
  }
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); load(); } catch (e) { guard(e); } };
  const reset = async (u: U) => {
    if (!confirm(`重置「${u.username}」的密码？对方会被强制下线，并需要用新的激活码重新设置密码。`)) return;
    try { const r = await post(`/api/admin/users/${u.id}/reset`); setReveal({ title: `已重置：${u.username}`, code: r.activationCode }); load(); } catch (e) { guard(e); }
  };
  const remove = (u: U) => { if (confirm(`永久删除用户「${u.username}」及其收藏、历史和歌单？此操作无法撤销。`)) act(() => del(`/api/admin/users/${u.id}`), '用户已删除'); };

  return (
    <>
      <div className="head"><div><h1>用户</h1><div className="sub">账号只能由管理员创建。新用户用一次性激活码首次登录，并自己设置密码，你不会知道对方的密码。</div></div>
        <button className="btn" onClick={() => { setErr(''); setForm({ username: '', displayName: '', maxQuality: 'exhigh' }); }}><Icon n="plus" s={16} />创建用户</button></div>
      {users === null ? <div className="center sub">加载中…</div> : (
        <div className="box" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>用户</th><th>状态</th><th>最高音质</th><th className="hm">收藏 / 播放</th><th className="hm">上次登录</th><th /></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td><b>{u.username}</b><div className="muted sm">{u.displayName !== u.username ? u.displayName : ''}</div></td>
                  <td><Pill kind={u.status === 'active' ? 'ok' : u.status === 'pending' ? 'wait' : ''}>{{ active: '正常', pending: '待激活', disabled: '已停用' }[u.status]}</Pill></td>
                  <td><select value={u.maxQuality} onChange={e => act(() => patch(`/api/admin/users/${u.id}`, { maxQuality: e.target.value }), '已更新音质上限')}>{Object.entries(QUALITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                  <td className="hm sub">{u.favorites} / {u.plays}</td>
                  <td className="hm sub">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '从未'}</td>
                  <td><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    {u.status !== 'pending' && <button className="btn ghost sm" onClick={() => act(() => patch(`/api/admin/users/${u.id}`, { status: u.status === 'active' ? 'disabled' : 'active' }), u.status === 'active' ? '已停用' : '已启用')}>{u.status === 'active' ? '停用' : '启用'}</button>}
                    <button className="btn ghost sm" onClick={() => reset(u)}>重置密码</button>
                    {u.status === 'active' && <button className="btn ghost sm" onClick={() => act(() => post(`/api/admin/users/${u.id}/kick`), '已强制下线')}>下线</button>}
                    <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => remove(u)}>删除</button>
                  </div></td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={6} className="center sub">还没有用户，点右上角「创建用户」。</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="mask" onMouseDown={e => e.target === e.currentTarget && setForm(null)}>
          <form className="modal" onSubmit={create}>
            <h2>创建用户</h2>
            <p className="sub" style={{ margin: '6px 0 18px' }}>创建后会生成一次性激活码，有效期 48 小时。</p>
            <div className="field"><label className="sm sub">用户名（小写字母、数字、下划线，3 到 24 位）</label><input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required autoFocus pattern="[A-Za-z0-9_]{3,24}" /></div>
            <div className="field"><label className="sm sub">昵称（选填）</label><input value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} maxLength={24} /></div>
            <div className="field"><label className="sm sub">最高音质（日常播放默认用「标准」，下载到设备时可以选到这个上限）</label><select value={form.maxQuality} onChange={e => setForm({ ...form, maxQuality: e.target.value })}>{Object.entries(QUALITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            {err && <div className="err">{err}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button type="button" className="btn ghost" onClick={() => setForm(null)}>取消</button><button className="btn">创建并生成激活码</button></div>
          </form>
        </div>
      )}
      {reveal && (
        <div className="mask"><div className="modal">
          <h2>{reveal.title}</h2>
          <p className="sub" style={{ marginTop: 6 }}>把激活码发给对方，48 小时内有效。关闭后将无法再次查看。</p>
          <div className="code">{reveal.code}</div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(reveal.code); toast('已复制'); }}><Icon n="copy" s={15} />复制</button>
            <button className="btn" onClick={() => setReveal(null)}>完成</button>
          </div>
        </div></div>
      )}
    </>
  );
}

/* ---------------- source account ---------------- */
function Source({ guard, toast }: P) {
  const [st, setSt] = useState<any>(null);
  const [qr, setQr] = useState<null | { key: string; img: string; msg: string }>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const load = useCallback(() => get('/api/admin/netease').then(setSt).catch(guard), [guard]);
  useEffect(() => { load(); return () => { if (timer.current) clearInterval(timer.current); }; }, [load]);

  async function start() {
    if (timer.current) clearInterval(timer.current);
    try {
      const r = await post('/api/admin/netease');
      setQr({ key: r.key, img: r.qrimg, msg: '请使用网易云音乐 App 扫码' });
      timer.current = setInterval(async () => {
        try {
          const c = await get(`/api/admin/netease/check?key=${encodeURIComponent(r.key)}`);
          if (c.code === 802) setQr(q => q && { ...q, msg: '已扫码，请在手机上确认登录' });
          if (c.code === 800) { clearInterval(timer.current!); setQr(q => q && { ...q, msg: '二维码已过期，请重新生成' }); }
          if (c.loggedIn) { clearInterval(timer.current!); setQr(null); toast('音源账号已登录'); load(); }
        } catch (e: any) { clearInterval(timer.current!); setQr(null); guard(e); }
      }, 2000);
    } catch (e) { guard(e); }
  }
  async function logout() {
    if (!confirm('退出音源账号后，所有用户将无法在线播放，直到重新扫码。确定吗？')) return;
    try { await del('/api/admin/netease'); toast('已退出'); load(); } catch (e) { guard(e); }
  }

  return (
    <>
      <div className="head"><div><h1>音源账号</h1><div className="sub">所有用户共用这个账号的权限来播放音乐。登录凭据只保存在服务器上，不会发给任何用户。</div></div></div>
      <div className="box pad row" style={{ gap: 28, alignItems: 'flex-start' }}>
        {qr ? <div className="qr"><img src={qr.img} alt="登录二维码" /></div> : null}
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2>当前状态</h2>
          <p style={{ margin: '8px 0 16px' }}>{!st ? '读取中…' : st.loggedIn ? <Pill kind="ok">已登录</Pill> : <Pill kind="bad">{st.expired ? '登录已失效' : '未登录'}</Pill>}
            {st?.savedAt && <span className="muted sm" style={{ marginLeft: 10 }}>登录于 {fmtDateTime(Date.parse(st.savedAt))}</span>}</p>
          {qr && <p className="sub" style={{ marginBottom: 14 }}>{qr.msg}</p>}
          <div className="row"><button className="btn" onClick={start}>{qr ? '重新生成二维码' : st?.loggedIn ? '重新扫码登录' : '扫码登录'}</button>{st?.loggedIn && <button className="btn ghost danger" style={{ color: 'var(--danger)' }} onClick={logout}>退出登录</button>}</div>
        </div>
      </div>
      <div className="note">可播放的音质取决于该账号实际拥有的权限。多人共用同一个账号可能违反音源平台的服务条款，请自行评估风险，并用「系统设置」里的限流来避免短时间大量请求。</div>
    </>
  );
}

/* ---------------- cache & library ---------------- */
function Storage({ guard, toast }: P) {
  const [cache, setCache] = useState<any>(null);
  const [lib, setLib] = useState<any[] | null>(null);
  const load = useCallback(() => { get('/api/admin/cache').then(setCache).catch(guard); get('/api/admin/library').then(r => setLib(r.songs)).catch(guard); }, [guard]);
  useEffect(() => { load(); }, [load]);
  async function clear() {
    if (!confirm('清空所有在线播放缓存？下次播放会重新加载。')) return;
    try { const r = await del('/api/admin/cache'); toast(`已清理 ${r.removed} 首`); load(); } catch (e) { guard(e); }
  }
  async function remove(id: string, name: string) {
    if (!confirm(`从本地库删除《${name}》？文件会被删除。`)) return;
    try { await del(`/api/admin/library/${id}`); toast('已删除'); load(); } catch (e) { guard(e); }
  }
  return (
    <>
      <div className="head"><div><h1>缓存与服务器音乐库</h1><div className="sub">在线播放缓存超出上限会自动清理。服务器音乐库保留旧版保存的文件，设备下载保存在用户自己的音乐文件夹。</div></div><button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={clear}>清空缓存</button></div>
      {cache && (
        <div className="stats">
          <div className="stat"><span className="sub sm">缓存占用</span><b>{fmtBytes(cache.bytes)}</b><div className="bar"><i style={{ width: `${Math.min(100, (cache.bytes / cache.limitBytes) * 100)}%` }} /></div></div>
          <div className="stat"><span className="sub sm">缓存上限</span><b>{fmtBytes(cache.limitBytes)}</b></div>
          <div className="stat"><span className="sub sm">缓存歌曲</span><b>{cache.songs}</b></div>
          <div className="stat"><span className="sub sm">命中次数</span><b>{cache.hits}</b></div>
        </div>
      )}
      <h2 style={{ margin: '28px 0 14px' }}>本地库</h2>
      <div className="box" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>歌曲</th><th className="hm">歌手</th><th>音质</th><th>大小</th><th className="hm">保存时间</th><th /></tr></thead>
          <tbody>
            {(lib || []).map(s => (
              <tr key={s.id}><td><b>{s.name}</b></td><td className="hm sub">{s.artists.map((a: any) => a.name).join(' / ')}</td><td>{QUALITY_LABEL[s.level] || s.level} · {String(s.ext).toUpperCase()}</td><td>{fmtBytes(s.size)}</td><td className="hm sub">{fmtDateTime(s.savedAt)}</td>
                <td style={{ textAlign: 'right' }}><button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => remove(s.id, s.name)}>删除</button></td></tr>
            ))}
            {lib && !lib.length && <tr><td colSpan={6} className="center sub">本地库还是空的。</td></tr>}
            {!lib && <tr><td colSpan={6} className="center sub">加载中…</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- audio-worker jobs ---------------- */
function Jobs({ guard, toast }: P) {
  const [d, setD] = useState<any>(null);
  const [form, setForm] = useState({ input: '', format: 'original', bitrate: 320 });
  const load = useCallback(() => get('/api/admin/worker').then(setD).catch(guard), [guard]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await post('/api/admin/worker', form); toast('任务已提交'); setForm({ ...form, input: '' }); load(); } catch (e) { guard(e); }
  }
  const kind = (s: string) => (s === 'completed' ? 'ok' : s === 'failed' ? 'bad' : 'wait');
  const label: Record<string, string> = { queued: '排队中', processing: '处理中', completed: '已完成', failed: '失败' };
  return (
    <>
      <div className="head"><div><h1>转换任务</h1><div className="sub">audio-worker 负责 NCM 解密和 MP3 转码，运行在 NAS 上。输入文件需要放在 NAS 的 storage/incoming 目录。</div></div>
        <div>{!d ? '' : !d.configured ? <Pill>未配置</Pill> : d.ok ? <Pill kind="ok">运行中</Pill> : <Pill kind="bad">无法连接</Pill>}</div></div>
      {d?.ok && (
        <form className="box pad row" style={{ gap: 12, alignItems: 'flex-end' }} onSubmit={submit}>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 220 }}><label className="sm sub">输入文件（相对 incoming 目录）</label><input value={form.input} onChange={e => setForm({ ...form, input: e.target.value })} placeholder="album/song.ncm" required /></div>
          <div className="field" style={{ margin: 0 }}><label className="sm sub">输出</label><select value={form.format} onChange={e => setForm({ ...form, format: e.target.value })}><option value="original">保持原格式</option><option value="mp3">转为 MP3</option></select></div>
          {form.format === 'mp3' && <div className="field" style={{ margin: 0 }}><label className="sm sub">码率</label><select value={form.bitrate} onChange={e => setForm({ ...form, bitrate: Number(e.target.value) })}>{[128, 192, 256, 320].map(b => <option key={b} value={b}>{b} kbps</option>)}</select></div>}
          <button className="btn">提交任务</button>
        </form>
      )}
      <div className="box" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>文件</th><th>输出</th><th>状态</th><th className="hm">阶段</th></tr></thead>
          <tbody>
            {(d?.jobs || []).map((j: any) => (
              <tr key={j.id}><td>{j.input}</td><td className="sub">{j.format === 'mp3' ? `MP3 ${j.bitrate || ''}` : '原格式'}</td><td><Pill kind={kind(j.status)}>{label[j.status] || j.status}</Pill>{j.error && <div className="muted sm">{String(j.error).slice(0, 80)}</div>}</td><td className="hm sub">{j.stage || '—'}</td></tr>
            ))}
            {d && !(d.jobs || []).length && <tr><td colSpan={4} className="center sub">{d.ok ? '还没有任务。' : '无法获取任务列表。'}</td></tr>}
            {!d && <tr><td colSpan={4} className="center sub">加载中…</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- system ---------------- */
function System({ guard, toast }: P) {
  const [s, setS] = useState<any>(null);
  const [o, setO] = useState<any>(null);
  useEffect(() => { get('/api/admin/settings').then(setS).catch(guard); get('/api/admin/overview').then(setO).catch(() => {}); }, [guard]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { setS(await patch('/api/admin/settings', s)); toast('设置已保存'); } catch (e) { guard(e); }
  }
  if (!s) return <div className="center sub">加载中…</div>;
  const f = (k: string, label: string, hint: string, unit: string) => (
    <div className="set"><div><b>{label}</b><div className="sub sm">{hint}</div></div>
      <div className="row" style={{ flexWrap: 'nowrap' }}><input className="sel" type="number" min={1} value={s[k]} onChange={e => setS({ ...s, [k]: Number(e.target.value) })} style={{ width: 90, textAlign: 'right' }} /><span className="sub sm">{unit}</span></div></div>
  );
  return (
    <>
      <div className="head"><div><h1>系统设置</h1>{o && <div className="sub">版本 {o.version} · 已运行 {uptime(o.uptimeSeconds)}</div>}</div></div>
      <form onSubmit={save}>
        <div className="box" style={{ padding: '0 22px' }}>
          {f('rateLimitPerMin', '每位用户每分钟请求上限', '防止单个用户短时间大量请求音源账号', '次 / 分钟')}
          {f('maxStreams', '每位用户同时加载歌曲数', '同一时间最多从音源下载几首歌', '首')}
          {f('cacheLimitGb', '缓存容量上限', '超出后自动清理最久没播放的歌曲', 'GB')}
        </div>
        <button className="btn">保存设置</button>
      </form>
      <div className="note" style={{ marginTop: 26 }}>管理密钥、audio-worker 地址等敏感配置来自服务器环境变量，不能在这里修改。</div>
    </>
  );
}
