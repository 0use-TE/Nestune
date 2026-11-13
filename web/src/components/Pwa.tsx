'use client';
import { Loading } from './Loading';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { AndroidRelease } from '@/server/client-updates';

type NativeClient = { platform: 'android'; version: string; versionCode: number; canDownload: boolean };
type NativeBridge = { postMessage: (message: string) => void; onmessage?: (event: { data: string }) => void };

const INSTALL_INTRO_KEY = 'nt-install-intro-v1';

function rememberInstallIntro() {
  try { localStorage.setItem(INSTALL_INTRO_KEY, 'seen'); } catch { /* Storage may be unavailable. */ }
}

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
type PwaState = {
  installed: boolean;
  secure: boolean;
  ios: boolean;
  canInstall: boolean;
  install: () => Promise<void>;
  available: boolean; updating: boolean; checking: boolean; status: string;
  checkUpdate: () => Promise<void>; update: () => void;
  android: AndroidRelease | null; client: NativeClient | null; downloadUpdate: () => void;
};
const PwaContext = createContext<PwaState | null>(null);

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [installed, setInstalled] = useState(false);
  const [secure, setSecure] = useState(true);
  const [ios, setIos] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [showInstallIntro, setShowInstallIntro] = useState(false);
  const requestedUpdate = useRef(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const waitingRef = useRef<ServiceWorker | null>(null);
  const [hideWebUpdate, setHideWebUpdate] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('');
  const [android, setAndroid] = useState<AndroidRelease | null>(null);
  const [client, setClient] = useState<NativeClient | null>(null);
  const [hideAndroidUpdate, setHideAndroidUpdate] = useState(true);

  useEffect(() => {
    const native = (window as Window & { NestuneNative?: NativeBridge }).NestuneNative;
    let versionReceived = false;
    if (/Android/.test(navigator.userAgent) && /NestuneDesktop\//.test(navigator.userAgent)) {
      // Android builds 2 and 3 predate the version-query bridge.
      const legacy = { platform: 'android' as const, version: /NestuneDesktop\/([\d.]+)/.exec(navigator.userAgent)?.[1] || '1.0.0', versionCode: native ? 3 : 2, canDownload: false };
      if (native) native.onmessage = event => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'clientInfo' && Number.isSafeInteger(data.versionCode)) { versionReceived = true; setClient({ ...data, platform: 'android' }); }
          if (data.type === 'downloadStarted') setStatus('正在下载，完成后点系统通知安装');
          if (data.type === 'downloadError') setStatus('无法启动下载，请稍后重试');
        } catch { /* Ignore unrelated native events. */ }
      };
      native?.postMessage(JSON.stringify({ type: 'clientInfo' }));
      const timer = setTimeout(() => { if (!versionReceived) setClient(legacy); }, 700);
      return () => { clearTimeout(timer); if (native) native.onmessage = undefined; };
    }
  }, []);
  useEffect(() => {
    if (!client) return;
    fetch('/api/client-updates', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(data => setAndroid(data.android)).catch(() => {});
  }, [client?.versionCode]);
  useEffect(() => {
    if (!client || !android || android.versionCode <= client.versionCode) { setHideAndroidUpdate(true); return; }
    let hidden = false;
    try { hidden = !!localStorage.getItem('nt-client-later-' + android.versionCode); } catch { /* Optional preference. */ }
    setHideAndroidUpdate(hidden);
  }, [client, android]);

  useEffect(() => {
    const display = matchMedia('(display-mode: standalone)');
    const isInstalled = () => display.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone || /NestuneDesktop\//.test(navigator.userAgent);
    const syncInstalled = () => {
      setInstalled(isInstalled());
      if (isInstalled()) { setShowInstallIntro(false); rememberInstallIntro(); }
    };
    syncInstalled();
    setSecure(window.isSecureContext);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); setShowInstallIntro(false); rememberInstallIntro(); };
    let introSeen = false;
    try { introSeen = !!localStorage.getItem(INSTALL_INTRO_KEY); } catch { /* Show once for this visit. */ }
    const eligible = !introSeen && window.isSecureContext && !isInstalled() && !/^\/admin(?:\/|$)/.test(location.pathname);
    let introShown = false;
    const showIntro = () => {
      if (!eligible || introShown || isInstalled() || document.visibilityState !== 'visible') return;
      introShown = true;
      rememberInstallIntro();
      setShowInstallIntro(true);
    };
    const introTimer = window.setTimeout(showIntro, 1800);
    document.addEventListener('visibilitychange', showIntro);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    display.addEventListener('change', syncInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      display.removeEventListener('change', syncInstalled);
      window.clearTimeout(introTimer);
      document.removeEventListener('visibilitychange', showIntro);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const inspect = () => {
      if (!disposed && registration?.waiting && navigator.serviceWorker.controller) {
        if (waitingRef.current !== registration.waiting) setHideWebUpdate(false);
        waitingRef.current = registration.waiting;
        setWaiting(registration.waiting);
      }
    };
    const onUpdate = () => {
      installing?.removeEventListener('statechange', inspect);
      installing = registration?.installing ?? null;
      installing?.addEventListener('statechange', inspect);
    };
    const onController = () => { if (requestedUpdate.current) window.location.reload(); };
    const check = () => { if (document.visibilityState === 'visible') void registration?.update().catch(() => {}); };
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
      if (disposed) return;
      registration = reg;
      registrationRef.current = reg;
      inspect();
      onUpdate();
      reg.addEventListener('updatefound', onUpdate);
    }).catch(() => { /* Installation can be retried on the next visit. */ });
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 60 * 60 * 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      registration?.removeEventListener('updatefound', onUpdate);
      installing?.removeEventListener('statechange', inspect);
      navigator.serviceWorker.removeEventListener('controllerchange', onController);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    setError('');
    setShowInstallIntro(false);
    rememberInstallIntro();
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { setError('未能打开安装窗口，请使用浏览器菜单安装。'); }
    finally { setPrompt(null); }
  }

  function update() {
    if (!waiting) return;
    requestedUpdate.current = true;
    setUpdating(true);
    waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
  }

  async function checkUpdate() {
    if (checking) return;
    setChecking(true); setStatus('');
    try {
      const response = await fetch('/api/client-updates', { cache: 'no-store' });
      if (!response.ok) throw new Error('暂时无法检查更新，请稍后重试');
      const data = await response.json(); setAndroid(data.android);
      const registration = registrationRef.current || (('serviceWorker' in navigator) ? await navigator.serviceWorker.getRegistration('/') : undefined);
      if (registration) {
        await registration.update();
        const installing = registration.installing;
        if (installing && installing.state !== 'installed' && installing.state !== 'redundant') await new Promise<void>((resolve, reject) => {
          const done = () => {
            if (installing.state !== 'installed' && installing.state !== 'redundant') return;
            clearTimeout(timer); installing.removeEventListener('statechange', done);
            installing.state === 'installed' ? resolve() : reject(new Error('更新未准备好，请重试'));
          };
          const timer = setTimeout(() => { installing.removeEventListener('statechange', done); reject(new Error('检查超时，请重试')); }, 20000);
          installing.addEventListener('statechange', done); done();
        });
        if (registration.waiting && navigator.serviceWorker.controller) {
          waitingRef.current = registration.waiting; setWaiting(registration.waiting);
          setStatus('网页更新已准备好');
        } else setStatus('网页已是最新版本');
      } else setStatus('检查完成，可刷新网页获取最新内容');
    } catch (error) { setStatus(error instanceof Error ? error.message : '检查更新失败'); }
    finally { setChecking(false); }
  }

  function downloadUpdate() {
    if (!android) return;
    const url = new URL(android.url, location.origin).href;
    const native = (window as Window & { NestuneNative?: NativeBridge }).NestuneNative;
    if (client?.canDownload && native) { native.postMessage(JSON.stringify({ type: 'downloadUpdate', url })); return; }
    navigator.clipboard.writeText(url).then(() => setStatus('下载链接已复制，请在浏览器中打开')).catch(() => setStatus('无法复制，请使用浏览器打开此站点下载'));
  }

  return <PwaContext.Provider value={{ installed, secure, ios, canInstall: !!prompt, install, available: !!waiting, updating, checking, status, checkUpdate, update, android, client, downloadUpdate }}>
    {children}
    {showInstallIntro && !installed && <section className="pwa-intro" aria-labelledby="pwa-intro-title">
      <img src="/pwa/icon-192.png" alt="" width={48} height={48} />
      <div className="pwa-intro-copy">
        <h2 id="pwa-intro-title">把 Nestune 放到桌面</h2>
        <p className="sub">下次轻点图标，就能打开你的音乐库。</p>
        {!prompt && <p className="sub sm">{ios ? '在 Safari 中轻点分享，选择「添加到主屏幕」。' : '打开浏览器菜单，选择「安装应用」或「添加到主屏幕」。'}</p>}
        <div className="pwa-intro-actions">
          {prompt && <button type="button" className="btn sm" onClick={() => void install()}>安装 Nestune</button>}
          <button type="button" className={prompt ? 'link' : 'btn ghost sm'} onClick={() => setShowInstallIntro(false)}>{prompt ? '暂不安装' : '知道了'}</button>
        </div>
      </div>
      <button type="button" className="ib pwa-intro-close" aria-label="关闭安装提醒" onClick={() => setShowInstallIntro(false)}><Icon n="x" s={17} /></button>
    </section>}
    {waiting && !hideWebUpdate && <div className="pwa-update" role="status">
      <span>新版本已准备好，更新会重新打开页面。</span>
      <button type="button" className="btn sm" disabled={updating} onClick={update}>{updating ? <Loading inline label="更新中" /> : '立即更新'}</button>
      {!updating && <button type="button" className="link" onClick={() => setHideWebUpdate(true)}>稍后</button>}
    </div>}
    {!hideAndroidUpdate && android && !waiting && <div className="pwa-update" role="status"><span>{status.includes('下载') ? status : 'Android 客户端有新版本'}</span><button className="btn sm" onClick={downloadUpdate}>{client?.canDownload ? '下载更新' : '复制下载链接'}</button><button className="link" onClick={() => { setHideAndroidUpdate(true); try { localStorage.setItem('nt-client-later-' + android.versionCode, '1'); } catch {} }}>稍后</button></div>}
    {error && <div className="pwa-update" role="alert"><span>{error}</span><button type="button" className="link" onClick={() => setError('')}>关闭</button></div>}
  </PwaContext.Provider>;
}

export function PwaInstall() {
  const pwa = useContext(PwaContext);
  if (!pwa) return null;
  return <div className="set pwa-install">
    <div><b>安装 Nestune</b><p className="sub sm">{pwa.installed ? '已安装，可从桌面打开。' : !pwa.secure ? '请通过 HTTPS 地址访问后安装。' : pwa.canInstall ? '添加到桌面，使用独立窗口听歌。' : pwa.ios ? '在 Safari 中打开，轻点分享，再选择「添加到主屏幕」。' : '在浏览器菜单中选择「安装应用」或「添加到主屏幕」。'}</p></div>
    {pwa.canInstall && !pwa.installed && <button type="button" className="btn sm" onClick={() => void pwa.install()}>安装</button>}
  </div>;
}

export function AboutNestune() {
  const pwa = useContext(PwaContext);
  if (!pwa) return null;
  const clientUpdate = pwa.android && pwa.client && pwa.android.versionCode > pwa.client.versionCode;
  return <section className="panel" aria-label="关于 Nestune">
    <div className="set"><div><b>Nestune</b><div className="sub sm">V{pwa.client?.version || '1.0.0'}</div></div>
      <button type="button" className="btn ghost sm" disabled={pwa.checking} onClick={() => void pwa.checkUpdate()}>{pwa.checking ? <Loading inline label="正在检查更新" /> : '检查更新'}</button>
    </div>
    {pwa.available && <div className="set"><b>网页更新</b><button type="button" className="btn sm" disabled={pwa.updating} onClick={pwa.update}>{pwa.updating ? <Loading inline label="正在更新" /> : '立即更新'}</button></div>}
    {pwa.client && pwa.android && <div className="set"><div><b>Android 客户端</b><div className="sub sm">{clientUpdate ? '有可用更新' : '已是最新版本'}</div></div>{clientUpdate && <button className="btn sm" onClick={pwa.downloadUpdate}>{pwa.client.canDownload ? '下载更新' : '复制下载链接'}</button>}</div>}
    {pwa.status && <p className="update-status sub sm" role="status">{pwa.status}</p>}
  </section>;
}
