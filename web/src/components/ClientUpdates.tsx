'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { clientUpdatesUrl } from '@/lib/client-updates';

type Client = { platform: string; version: string; updateProtocol: number; architecture?: string };
type Release = { version: string; versionCode: number; size: number; url: string };
type Transfer = { phase: string; received?: number; total?: number; error?: string };
type Host = Window & { NestuneDesktop?: { request: (data: unknown) => Promise<unknown> }; NestuneNative?: { postMessage: (message: string) => void } };
const busy = (phase: string) => ['checking', 'downloading', 'verifying', 'installing'].includes(phase);
export function newerVersion(next: string, current: string): boolean {
  const parse = (s: string) => /^\d+\.\d+\.\d+$/.test(s) ? s.split('.').map(Number) : null;
  const a = parse(next), b = parse(current); if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
async function request(type: string): Promise<Record<string, unknown>> {
  const host = window as Host;
  if (host.NestuneDesktop) return await host.NestuneDesktop.request({ type }) as Record<string, unknown>;
  if (!host.NestuneNative) throw Error('此客户端需要手动升级');
  return new Promise((resolve, reject) => {
    const id = `update-${Date.now()}-${Math.random()}`;
    const receive = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (data?.requestId !== id) return;
      clearTimeout(timer); window.removeEventListener('nt:native-message', receive); resolve(data);
    };
    const timer = setTimeout(() => { window.removeEventListener('nt:native-message', receive); reject(Error('客户端未响应，请重试或手动下载安装')); }, 5000);
    window.addEventListener('nt:native-message', receive);
    host.NestuneNative!.postMessage(JSON.stringify({ type, requestId: id }));
  });
}
type State = { client: Client | null; release: Release | null; transfer: Transfer; checking: boolean; check: () => Promise<void>; start: () => Promise<void>; install: () => Promise<void>; message: string; updateAvailable: boolean };
const Context = createContext<State | null>(null);
const labels: Record<string, string> = { android: 'Android', windows: 'Windows', linux: 'Linux', macos: 'macOS' };
const megabytes = (bytes: number) => (bytes / 1048576).toFixed(1);

export function ClientUpdatesProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<Client | null>(null);
  const [release, setRelease] = useState<Release | null>(null);
  const [transfer, setTransfer] = useState<Transfer>({ phase: 'idle' });
  const [checking, setChecking] = useState(false), [message, setMessage] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const autoInstall = useRef(false), mounted = useRef(true), polling = useRef(false);
  const check = useCallback(async () => {
    setChecking(true); setMessage('');
    try {
      const response = await fetch(clientUpdatesUrl(), { cache: 'no-store' });
      if (!response.ok) throw Error(`检查客户端更新失败（${response.status}）`);
      const manifest = await response.json();
      setRelease(client?.platform === 'android' ? manifest.android : client?.platform === 'windows' ? manifest.windows : null);
      setMessage(client && !['windows', 'android'].includes(client.platform) ? '此平台请在下载页查看并安装新版客户端。' : '客户端检查完成');
    } catch (error) { setMessage(error instanceof Error ? error.message : '检查客户端更新失败'); }
    finally { setChecking(false); }
  }, [client]);
  useEffect(() => {
    mounted.current = true;
    const version = /NestuneDesktop\/([\d.]+)/.exec(navigator.userAgent)?.[1];
    if (!version) return;
    const platform = /Android/.test(navigator.userAgent) ? 'android' : /Windows/.test(navigator.userAgent) ? 'windows' : /Mac/.test(navigator.userAgent) ? 'macos' : 'linux';
    const legacy: Client = { platform, version, updateProtocol: 0 };
    setClient(legacy);
    // Parent PwaProvider installs the shared Android message dispatcher first.
    const timer = setTimeout(() => { void request('updateInfo').then(info => {
      if (mounted.current && typeof info.version === 'string') setClient({ ...legacy, ...info } as Client);
    }).catch(() => { /* Old clients have no updater; keep the manual bootstrap action. */ }); }, 0);
    return () => { mounted.current = false; clearTimeout(timer); };
  }, []);
  useEffect(() => { if (client) void check(); }, [check, client]);
  const install = useCallback(async () => {
    try {
      setMessage('正在打开安装程序…');
      const result = await request('updateInstall') as Transfer;
      if (result.phase === 'error') throw Error(result.error || '安装程序启动失败');
      setTransfer(result); setMessage(result.phase === 'permission' ? '请允许此应用安装更新，返回后点「继续安装」。' : '已打开系统安装界面，请确认安装；若取消，可继续安装。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '无法打开安装程序'); }
  }, []);
  const start = useCallback(async () => {
    if (busy(transfer.phase)) return;
    setDismissed(false); setMessage(''); autoInstall.current = true;
    try {
      const result = await request('updateStart') as Transfer;
      setTransfer(result);
      if (result.phase === 'error') setMessage(result.error || '下载失败，请重试');
    } catch (error) { setTransfer({ phase: 'error' }); setMessage(error instanceof Error ? error.message : '下载启动失败'); }
  }, [transfer.phase]);
  useEffect(() => {
    if (!client?.updateProtocol) return;
    const poll = async () => {
      if (polling.current) return; polling.current = true;
      try {
        const next = await request('updateStatus') as Transfer;
        if (!mounted.current || !next.phase) return;
        setTransfer(next);
        if (next.phase === 'error') { autoInstall.current = false; setMessage(next.error || '下载失败，请重试'); }
        if (next.phase === 'ready' && autoInstall.current) { autoInstall.current = false; await install(); }
      } catch (error) { if (autoInstall.current) setMessage(error instanceof Error ? error.message : '无法读取下载进度'); }
      finally { polling.current = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 1000);
    return () => clearInterval(timer);
  }, [client?.updateProtocol, install]);
  const updateAvailable = !!client && !!release && newerVersion(release.version, client.version);
  const state = { client, release, transfer, checking, check, start, install, message, updateAvailable };
  return <Context.Provider value={state}>{children}
    {client && updateAvailable && !dismissed && <div className="pwa-update client-update-notice" role="status">
      <span>{labels[client.platform]} 客户端 {release!.version}{!client.updateProtocol ? '：此旧版需手动下载安装一次' : busy(transfer.phase) ? '：正在更新' : ' 可更新'}</span>
      <UpdateAction state={state} />
      {!busy(transfer.phase) && <button className="link" onClick={() => setDismissed(true)}>稍后</button>}
      <Progress transfer={transfer} message={message} />
    </div>}
  </Context.Provider>;
}
function UpdateAction({ state }: { state: State }) {
  if (!state.client?.updateProtocol) return <ManualDownload />;
  if (busy(state.transfer.phase)) return <span className="sub sm">{state.transfer.phase === 'checking' ? '准备下载…' : state.transfer.phase === 'verifying' ? '校验安装包…' : state.transfer.phase === 'installing' ? '正在打开安装程序…' : '正在下载…'}</span>;
  if (['ready', 'permission'].includes(state.transfer.phase)) return <button className="btn sm" onClick={() => void state.install()}>继续安装</button>;
  return <button className="btn sm" onClick={() => void state.start()}>{state.transfer.phase === 'error' ? '重试下载' : '下载并安装'}</button>;
}
function Progress({ transfer, message }: { transfer: Transfer; message: string }) {
  const total = transfer.total || 0, received = transfer.received || 0;
  const percent = total ? Math.min(100, Math.floor(received * 100 / total)) : 0;
  return <div className="client-update-progress" aria-live="polite">
    {total > 0 && <><progress aria-label="客户端更新下载进度" value={received} max={total} /><span className="sub sm">{percent}% · {megabytes(received)} / {megabytes(total)} MB</span></>}
    {(message || transfer.error) && <span className="sub sm">{message || transfer.error}</span>}
  </div>;
}
export function ClientUpdatesSettings() {
  const state = useContext(Context); if (!state?.client) return null;
  return <>
    <div className="set"><div><b>{labels[state.client.platform]} 客户端更新</b><p className="sub sm">当前 V{state.client.version}{state.release && <> · 可用 V{state.release.version}</>}</p></div>
      <button className="btn ghost sm" disabled={state.checking} onClick={() => void state.check()}>{state.checking ? '检查中…' : '检查客户端更新'}</button>
    </div>
    <div className="pad"><p className="sub sm">{state.client.updateProtocol ? state.client.platform === 'android' ? '应用内下载并校验，完成后打开系统安装界面，需确认安装。' : '应用内下载并校验，完成后退出当前客户端并打开安装程序；按安装向导完成更新。' : '此版本不支持应用内安装更新。复制下载页地址，在系统浏览器中下载并覆盖安装新版；之后可在这里下载更新。'}</p>
      {(state.updateAvailable || !state.client.updateProtocol || ['ready', 'permission', 'error'].includes(state.transfer.phase)) && <UpdateAction state={state} />}
      <Progress transfer={state.transfer} message={state.message} />
      {state.client.updateProtocol > 0 && <ManualDownload />}
    </div>
  </>;
}

function ManualDownload() {
  const [message, setMessage] = useState('');
  const copy = async () => {
    const url = new URL('/downloads', location.origin).href;
    try { await navigator.clipboard.writeText(url); setMessage('已复制，请粘贴到系统浏览器下载安装。'); }
    catch { setMessage(`请在系统浏览器打开：${url}`); }
  };
  return <span className="client-update-manual"><button className="btn ghost sm" onClick={() => void copy()}>复制手动下载地址</button>{message && <span className="sub sm" role="status">{message}</span>}</span>;
}
