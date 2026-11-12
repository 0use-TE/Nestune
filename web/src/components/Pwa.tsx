'use client';
import { Loading } from './Loading';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

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
      if (!disposed && registration?.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
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

  return <PwaContext.Provider value={{ installed, secure, ios, canInstall: !!prompt, install }}>
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
    {waiting && <div className="pwa-update" role="status">
      <span>新版本已准备好，更新会重新打开页面。</span>
      <button type="button" className="btn sm" disabled={updating} onClick={update}>{updating ? <Loading inline label="更新中" /> : '立即更新'}</button>
      {!updating && <button type="button" className="link" onClick={() => setWaiting(null)}>稍后</button>}
    </div>}
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
