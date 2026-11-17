'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { overlayLine, type OverlayData, type OverlayMedia } from '@/lib/overlay-lyrics';

type State = { supported: boolean; enabled: boolean; locked: boolean; permission: boolean; platform: 'desktop' | 'android' | 'browser' };
type Command = { type: string; [key: string]: unknown } | OverlayData | OverlayMedia;
type NativeWindow = Window & {
  NestuneDesktop?: { request: (data: Command) => Promise<State> };
  NestuneNative?: { postMessage: (data: string) => void };
  documentPictureInPicture?: { requestWindow: (options: { width: number; height: number }) => Promise<Window> };
};
type Context = State & { busy: boolean; status: string; setEnabled: (value: boolean) => Promise<void>; setLocked: (value: boolean) => Promise<void>; send: (data: OverlayData | OverlayMedia) => void };
const INITIAL: State = { supported: false, enabled: false, locked: false, permission: false, platform: 'browser' };
const LyricsContext = createContext<Context>(null as never);
export const useDesktopLyrics = () => useContext(LyricsContext);

async function nativeRequest(data: Command): Promise<State> {
  const host = window as NativeWindow;
  if (host.NestuneDesktop) return host.NestuneDesktop.request(data);
  if (!host.NestuneNative) throw Error('请更新客户端后使用桌面歌词');
  const bridge = host.NestuneNative;
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
  const pip = useRef<Window | null>(null);
  const content = useRef<OverlayData | null>(null);
  const media = useRef({ id: '', position: 0, playing: false, at: 0 });
  const stateRef = useRef(state); stateRef.current = state;
  const accept = useCallback((next: State) => {
    if (next?.supported === true && typeof next.enabled === 'boolean') setState(next);
  }, []);
  useEffect(() => {
    const host = window as NativeWindow;
    let alive = true;
    const inspect = () => {
      if (host.NestuneDesktop || host.NestuneNative) nativeRequest({ type: 'lyricsInfo' }).then(value => { if (alive) accept(value); }).catch(() => {});
      else setState(previous => ({ ...previous, supported: !!host.documentPictureInPicture && window.isSecureContext, permission: true, platform: 'browser' }));
    };
    const receive = (event: Event) => accept((event as CustomEvent).detail);
    const timer = setTimeout(inspect, 0);
    window.addEventListener('focus', inspect); window.addEventListener('nt:lyrics-state', receive);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('focus', inspect); window.removeEventListener('nt:lyrics-state', receive); pip.current?.close(); };
  }, [accept]);
  const setEnabled = useCallback(async (enabled: boolean) => {
    if (busy) return;
    setBusy(true); setStatus('');
    try {
      const host = window as NativeWindow;
      if (stateRef.current.platform === 'browser' && !host.NestuneDesktop && !host.NestuneNative) {
        if (!enabled) { pip.current?.close(); pip.current = null; setState(previous => ({ ...previous, enabled: false })); return; }
        if (!host.documentPictureInPicture) throw Error('此浏览器暂不支持桌面歌词，请使用新版客户端');
        const child = await host.documentPictureInPicture.requestWindow({ width: 560, height: 150 });
        pip.current = child;
        child.document.title = 'Nestune · 歌词';
        const style = child.document.createElement('style');
        style.textContent = ':root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:14px 22px;min-height:100vh;display:flex;flex-direction:column;justify-content:center;text-align:center;background:#fbfaf8;color:#141413;font-family:system-ui,"Microsoft YaHei",sans-serif}h1{font-size:clamp(18px,5vw,29px);line-height:1.35;margin:0;font-weight:650;overflow-wrap:anywhere}p{margin:7px 0 0;color:#6d6c66;font-size:15px}small{display:block;margin:10px 0 0;color:#a3a29b;font-size:10px}@media(prefers-color-scheme:dark){body{background:#0f0f0e;color:#f4f3ef}p{color:#a09f98}}';
        child.document.head.append(style);
        const text = child.document.createElement('h1'), translation = child.document.createElement('p'), title = child.document.createElement('small');
        child.document.body.replaceChildren(text, translation, title);
        const update = () => {
          const current = media.current;
          const position = current.position + (current.playing ? (Date.now() - current.at) / 1000 : 0);
          const line = overlayLine(content.current, current.id, position);
          text.textContent = line.text; translation.textContent = line.tr; title.textContent = content.current?.title || 'Nestune';
          translation.hidden = !line.tr;
        };
        update(); const timer = child.setInterval(update, 120);
        child.addEventListener('pagehide', () => { child.clearInterval(timer); if (pip.current === child) { pip.current = null; setState(previous => ({ ...previous, enabled: false })); } }, { once: true });
        setState(previous => ({ ...previous, enabled: true }));
      } else {
        const next = await nativeRequest({ type: 'lyricsEnable', enabled }); accept(next);
        if (enabled && !next.permission) setStatus('请在系统设置中允许“显示在其他应用上层”，返回后即可显示歌词');
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : '无法打开桌面歌词'); }
    finally { setBusy(false); }
  }, [accept, busy]);
  const setLocked = useCallback(async (locked: boolean) => {
    try { accept(await nativeRequest({ type: 'lyricsLock', locked })); setStatus(locked ? '歌词已锁定，可在这里解锁' : '歌词已解锁'); }
    catch (error) { setStatus(error instanceof Error ? error.message : '无法调整歌词窗口'); }
  }, [accept]);
  const send = useCallback((data: OverlayData | OverlayMedia) => {
    if (data.type === 'lyricsData') content.current = data;
    else media.current = { id: data.id, position: data.position, playing: data.playing, at: Date.now() };
    if (!stateRef.current.enabled || stateRef.current.platform === 'browser') return;
    const host = window as NativeWindow;
    if (host.NestuneDesktop) void host.NestuneDesktop.request(data).catch(() => {});
    else host.NestuneNative?.postMessage(JSON.stringify(data));
  }, []);
  const value = useMemo(() => ({ ...state, busy, status, setEnabled, setLocked, send }), [state, busy, status, setEnabled, setLocked, send]);
  return <LyricsContext.Provider value={value}>{children}</LyricsContext.Provider>;
}

export function DesktopLyricsSettings() {
  const lyrics = useDesktopLyrics();
  return <>
    <div className="set"><div><b>桌面歌词</b><p className="sub sm">{lyrics.supported ? lyrics.platform === 'browser' ? '在独立画中画窗口显示歌词' : '切换到其他应用时也能看歌词' : '新版客户端支持在应用外显示歌词'}</p></div>
      <div className="lyrics-native-actions"><button type="button" className="btn ghost sm" disabled={!lyrics.supported || lyrics.busy} onClick={() => void lyrics.setEnabled(!lyrics.enabled)}>{lyrics.enabled ? '关闭' : '打开桌面歌词'}</button>
        {lyrics.enabled && lyrics.platform !== 'browser' && <button type="button" className="btn ghost sm" onClick={() => void lyrics.setLocked(!lyrics.locked)}>{lyrics.locked ? '解锁歌词' : '锁定歌词'}</button>}
      </div>
    </div>
    {lyrics.status && <p className="sub sm pad" role="status">{lyrics.status}</p>}
  </>;
}
