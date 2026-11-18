'use client';
import { clientUpdatesUrl } from '@/lib/client-updates';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { overlayCurrent, overlayLine, type OverlayData, type OverlayMedia } from '@/lib/overlay-lyrics';
import { createRoot } from 'react-dom/client';
import { KaraokeText } from './KaraokeText';
import { lyricsNativeBridge, lyricsOpenFailure, lyricsTransport } from '@/lib/lyrics-capability';
import { LYRICS_IDLE_MS, LyricsPlaybackControls } from './PlaybackControls';

type State = { supported: boolean; enabled: boolean; locked: boolean; permission: boolean; platform: 'desktop' | 'android' | 'browser' };
type Command = { type: string; [key: string]: unknown } | OverlayData | OverlayMedia;
type NativeWindow = Window & {
  NestuneDesktop?: { request: (data: Command) => Promise<State> };
  NestuneNative?: { postMessage: (data: string) => void };
  __TAURI_INTERNALS__?: { invoke: (command: string, args: unknown) => Promise<State> };
  chrome?: { webview?: unknown };
  documentPictureInPicture?: { requestWindow: (options: { width: number; height: number }) => Promise<Window> };
};
const ANDROID_CONTENT = [
  ['title', '显示歌名'],
  ['translation', '显示翻译'],
] as const;
type AndroidContentField = typeof ANDROID_CONTENT[number][0];
type AndroidContent = Record<AndroidContentField, boolean>;
const androidContentKey = (field: AndroidContentField) => `nt-android-lyrics-${field}`;
type Context = State & {
  busy: boolean; status: string; windowLabel: string; upgradeRequired: boolean;
  androidContent: AndroidContent; setAndroidContent: (field: AndroidContentField, visible: boolean) => void;
  setEnabled: (value: boolean) => Promise<boolean>; setLocked: (value: boolean) => Promise<void>; send: (data: OverlayData | OverlayMedia) => void;
};
const INITIAL: State = { supported: false, enabled: false, locked: false, permission: false, platform: 'browser' };
const ANDROID_PERMISSION_HINT = '请允许 Nestune 显示在其他应用上层，返回后即可开启系统悬浮歌词。';
const LyricsContext = createContext<Context>(null as never);
export const useDesktopLyrics = () => useContext(LyricsContext);
function nativeBridge(host: NativeWindow) {
  return lyricsNativeBridge({ desktop: typeof host.NestuneDesktop?.request === 'function', android: typeof host.NestuneNative?.postMessage === 'function', tauri: typeof host.__TAURI_INTERNALS__?.invoke === 'function' });
}
function transport() {
  const host = window as NativeWindow;
  return lyricsTransport({ desktop: typeof host.NestuneDesktop?.request === 'function', android: typeof host.NestuneNative?.postMessage === 'function',
    tauri: typeof host.__TAURI_INTERNALS__?.invoke === 'function', embedded: !!host.chrome?.webview, secure: window.isSecureContext,
    pictureInPicture: typeof host.documentPictureInPicture?.requestWindow === 'function', userAgent: navigator.userAgent });
}

async function nativeRequest(data: Command): Promise<State> {
  const host = window as NativeWindow;
  const kind = nativeBridge(host);
  if (kind === 'desktop') return host.NestuneDesktop!.request(data);
  if (kind === 'tauri') return host.__TAURI_INTERNALS__!.invoke('lyrics_command', { data });
  if (kind !== 'android') throw Error('请更新客户端后使用桌面歌词');
  const bridge = host.NestuneNative!;
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const receive = (event: Event) => {
      const reply = (event as CustomEvent).detail;
      if (reply?.requestId !== requestId) return;
      clearTimeout(timer); window.removeEventListener('nt:native-message', receive);
      if (reply.error) reject(Error(reply.error)); else resolve(reply);
    };
    const timer = setTimeout(() => { window.removeEventListener('nt:native-message', receive); reject(Error('请更新客户端后使用桌面歌词')); }, 1800);
    window.addEventListener('nt:native-message', receive);
    bridge.postMessage(JSON.stringify({ ...data, requestId }));
  });
}

export function DesktopLyricsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [androidContent, setAndroidContentState] = useState<AndroidContent>({ title: false, translation: false });
  useEffect(() => {
    try {
      setAndroidContentState({
        title: localStorage.getItem(androidContentKey('title')) === '1',
        translation: localStorage.getItem(androidContentKey('translation')) === '1',
      });
    } catch { /* Storage may be unavailable. */ }
  }, []);
  const setAndroidContent = useCallback((field: AndroidContentField, visible: boolean) => {
    setAndroidContentState(previous => ({ ...previous, [field]: visible }));
    try { localStorage.setItem(androidContentKey(field), visible ? '1' : '0'); } catch { /* Storage may be unavailable. */ }
  }, []);
  const pendingPermission = useRef(false);
  const changing = useRef(false);
  const pip = useRef<Window | null>(null);
  const content = useRef<OverlayData | null>(null);
  const media = useRef<OverlayMedia & { at: number }>({ type: 'lyricsMedia', id: '', position: 0, playing: false, at: 0 });
  const stateRef = useRef(state); stateRef.current = state;
  const accept = useCallback((next: State) => {
    if (next?.supported !== true || typeof next.enabled !== 'boolean') return;
    setState(next);
    if (next.platform === 'android' && pendingPermission.current && next.enabled) {
      pendingPermission.current = false;
      setStatus('');
    }
  }, []);
  useEffect(() => {
    const host = window as NativeWindow;
    let alive = true;
    const inspect = () => {
      const kind = transport();
      if (kind === 'native') nativeRequest({ type: 'lyricsInfo' }).then(value => {
        if (alive) {
          accept(value);
          setUpgradeRequired(false);
          setStatus(pendingPermission.current && !value.permission ? ANDROID_PERMISSION_HINT : '');
        }
      }).catch(() => { if (alive) {
        const android = !!host.NestuneNative;
        setState({ ...INITIAL, platform: android ? 'android' : 'desktop' }); setUpgradeRequired(!android);
        setStatus(android ? '请更新安卓客户端后使用系统歌词' : lyricsOpenFailure(true));
      } });
      else {
        setState(previous => ({ ...previous, supported: kind === 'pip', permission: true, platform: kind === 'upgrade' ? 'desktop' : 'browser' }));
        setUpgradeRequired(kind === 'upgrade');
        if (kind === 'upgrade') setStatus(lyricsOpenFailure(true));
      }
    };
    const receive = (event: Event) => accept((event as CustomEvent).detail);
    const timer = setTimeout(inspect, 0);
    window.addEventListener('focus', inspect); window.addEventListener('nt:lyrics-state', receive);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('focus', inspect); window.removeEventListener('nt:lyrics-state', receive); pip.current?.close(); };
  }, [accept]);
  const setEnabled = useCallback(async (enabled: boolean) => {
    if (changing.current) return stateRef.current.enabled;
    changing.current = true;
    setBusy(true); setStatus('');
    if (!enabled) pendingPermission.current = false;
    const kind = transport();
    try {
      const host = window as NativeWindow;
      if (kind === 'upgrade') { setUpgradeRequired(true); throw Error(lyricsOpenFailure(true)); }
      if (kind === 'unsupported') throw Error(lyricsOpenFailure(false));
      if (kind === 'pip') {
        if (!enabled) { pip.current?.close(); pip.current = null; setState(previous => ({ ...previous, enabled: false })); return false; }
        if (!host.documentPictureInPicture) throw Error('此浏览器暂不支持桌面歌词，请使用新版客户端');
        const child = await host.documentPictureInPicture.requestWindow({ width: 560, height: 185 });
        pip.current = child;
        child.document.title = 'Nestune · 歌词';
        const style = child.document.createElement('style');
        style.textContent = ':root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:14px 22px;min-height:100vh;display:flex;flex-direction:column;justify-content:center;text-align:center;background:#fbfaf8;color:#141413;font-family:system-ui,"Microsoft YaHei",sans-serif}h1{font-size:clamp(18px,5vw,29px);line-height:1.35;margin:0;font-weight:650;overflow-wrap:anywhere}p{margin:7px 0 0;color:#6d6c66;font-size:15px}small{display:block;margin:10px 0 0;color:#a3a29b;font-size:10px}@media(prefers-color-scheme:dark){body{background:#0f0f0e;color:#f4f3ef}p{color:#a09f98}}';
        for (const sheet of document.querySelectorAll('link[rel=stylesheet],style')) child.document.head.append(sheet.cloneNode(true));
        child.document.head.append(style);
        const text = child.document.createElement('h1'), translation = child.document.createElement('p'), title = child.document.createElement('small');
        const controls = child.document.createElement('div');
        controls.className = 'pinned-lyrics-actions';
        child.document.body.replaceChildren(text, translation, title, controls);
        const lyricsRoot = createRoot(text);
        const controlsRoot = createRoot(controls);
        let controlsKey = '';
        let idleTimer = 0;
        const wake = () => {
          delete controls.dataset.idle;
          child.clearTimeout(idleTimer);
          idleTimer = child.setTimeout(() => { controls.dataset.idle = ''; }, LYRICS_IDLE_MS);
        };
        const onControl = (action: string) => {
          wake();
          window.dispatchEvent(new CustomEvent('nt:desktop-control', { detail: action }));
        };
        for (const event of ['pointermove', 'pointerdown', 'focusin']) child.document.addEventListener(event, wake);
        wake();
        const update = () => {
          const current = media.current;
          const position = current.position + (current.playing ? (Date.now() - current.at) / 1000 : 0);
          const line = overlayLine(content.current, current.id, position);
          const vocal = overlayCurrent(content.current, current.id, position);
          lyricsRoot.render(vocal ? <KaraokeText line={vocal.line} nextTime={vocal.nextTime} position={position} playing={current.playing} flowSeed={content.current?.flowSeed} duration={content.current?.duration} /> : line.text);
          translation.textContent = line.tr; title.textContent = content.current?.title || 'Nestune';
          translation.hidden = !line.tr;
          const mode = current.mode ?? 'off';
          const key = `${mode}:${current.playing}`;
          if (controlsKey !== key) {
            controlsKey = key;
            controlsRoot.render(<LyricsPlaybackControls mode={mode} playing={current.playing} onControl={onControl} />);
          }
        };
        update(); const timer = child.setInterval(update, 120);
        child.addEventListener('pagehide', () => {
          child.clearInterval(timer);
          child.clearTimeout(idleTimer);
          lyricsRoot.unmount();
          controlsRoot.unmount();
          if (pip.current === child) { pip.current = null; setState(previous => ({ ...previous, enabled: false })); }
        }, { once: true });
        setState(previous => ({ ...previous, enabled: true }));
        return true;
      } else {
        const next = await nativeRequest({ type: 'lyricsEnable', enabled });
        accept(next);
        if (enabled && next.platform === 'android') {
          pendingPermission.current = !next.permission;
          if (pendingPermission.current) setStatus(ANDROID_PERMISSION_HINT);
          else if (!next.enabled) setStatus('系统浮窗未能打开，请检查 Nestune 的悬浮窗权限。');
        }
        return next.enabled;
      }
    } catch (error) {
      if (kind === 'pip') { pip.current?.close(); pip.current = null; setState(previous => ({ ...previous, enabled: false })); }
      setStatus(kind === 'pip' ? lyricsOpenFailure(false) : error instanceof Error ? error.message : '无法打开桌面歌词');
      return false;
    }
    finally { changing.current = false; setBusy(false); }
  }, [accept]);
  const setLocked = useCallback(async (locked: boolean) => {
    try { accept(await nativeRequest({ type: 'lyricsLock', locked })); setStatus(locked ? stateRef.current.platform === 'desktop' ? '歌词位置已锁定，窗口按钮仍可使用' : '歌词已锁定，可在这里解锁' : '歌词已解锁'); }
    catch (error) { setStatus(error instanceof Error ? error.message : '无法调整歌词窗口'); }
  }, [accept]);
  const send = useCallback((data: OverlayData | OverlayMedia) => {
    if (data.type === 'lyricsData') content.current = data;
    else media.current = { ...data, at: Date.now() };
    if (!stateRef.current.enabled || stateRef.current.platform === 'browser') return;
    const host = window as NativeWindow;
    const kind = nativeBridge(host);
    if (kind === 'desktop') void host.NestuneDesktop!.request(data).catch(() => {});
    else if (kind === 'android') host.NestuneNative!.postMessage(JSON.stringify(data));
    else if (kind === 'tauri') void host.__TAURI_INTERNALS__!.invoke('lyrics_command', { data }).catch(() => {});
  }, []);
  const windowLabel = state.platform === 'android' ? '系统悬浮歌词' : '桌面歌词';
  const value = useMemo(() => ({
    ...state, busy, status, windowLabel, upgradeRequired, androidContent, setAndroidContent, setEnabled, setLocked, send,
  }), [state, busy, status, windowLabel, upgradeRequired, androidContent, setAndroidContent, setEnabled, setLocked, send]);
  return <LyricsContext.Provider value={value}>{children}
    {state.enabled && state.locked && state.platform !== 'browser' && <div className="pwa-update" role="status"><span>{state.platform === 'android' ? '悬浮歌词已锁定' : '桌面歌词已锁定'}</span><button className="btn sm" onClick={() => void setLocked(false)}>解锁歌词</button><button className="link" onClick={() => void setEnabled(false)}>关闭歌词</button></div>}
  </LyricsContext.Provider>;
}

export function LyricsClientUpgrade() {
  const [release, setRelease] = useState<{ url: string; version: string } | null>(null);
  useEffect(() => { let alive = true; fetch(clientUpdatesUrl(), { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(data => { if (alive && data?.windows) setRelease(data.windows); }).catch(() => {}); return () => { alive = false; }; }, []);
  return release ? <a className="btn ghost sm" href={release.url} download>下载 Windows {release.version}</a> : <p className="sub sm">可在「关于 → 更新公告」下载新版 Windows 客户端。</p>;
}

export function DesktopLyricsSettings() {
  const lyrics = useDesktopLyrics();
  return <>
    <div className="set"><div><b>{lyrics.windowLabel}</b><p className="sub sm">{lyrics.supported ? lyrics.platform === 'browser' ? '在独立画中画窗口显示歌词' : '切换到其他应用时也能看歌词' : '新版客户端支持在应用外显示歌词'}</p></div>
      <div className="lyrics-native-actions"><button type="button" className="btn ghost sm" disabled={!lyrics.supported || lyrics.busy} onClick={() => void lyrics.setEnabled(!lyrics.enabled)}>{lyrics.enabled ? '关闭' : `打开${lyrics.windowLabel}`}</button>
        {lyrics.enabled && lyrics.platform !== 'browser' && <button type="button" className="btn ghost sm" onClick={() => void lyrics.setLocked(!lyrics.locked)}>{lyrics.locked ? '解锁歌词' : '锁定歌词'}</button>}
      </div>
    </div>
    {lyrics.platform === 'android' && <div role="group" aria-label="悬浮歌词内容">
      {ANDROID_CONTENT.map(([field, label]) => <div className="set" key={field}>
        <b>悬浮歌词{label}</b>
        <button type="button" className={`switch ${lyrics.androidContent[field] ? 'on' : ''}`} role="switch"
          aria-label={`悬浮歌词${label}`} aria-checked={lyrics.androidContent[field]}
          onClick={() => lyrics.setAndroidContent(field, !lyrics.androidContent[field])} />
      </div>)}
    </div>}
    {lyrics.status && <p className="sub sm pad" role="status">{lyrics.status}</p>}
    {lyrics.upgradeRequired && <div className="pad"><LyricsClientUpgrade /></div>}
  </>;
}
