'use client';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import type { AndroidRelease, WindowsRelease } from '@/server/client-updates';

const RELEASE = 'lyrics-controls-1.1.1';
export function ReleaseNotes({ onClose }: { onClose: () => void }) {
  const [packages, setPackages] = useState<{ android: AndroidRelease | null; windows: WindowsRelease | null } | null>(null);
  useEffect(() => { let alive = true; fetch('/api/client-updates', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(data => { if (alive) setPackages(data); }).catch(() => {}); return () => { alive = false; }; }, []);
  return <Sheet title="更新公告" onClose={onClose} className="release-sheet">
    <div className="release-notes">
      <p className="sub sm">Nestune 1.1.1 · 2026 年 11 月 17 日</p>
      <h3>Windows 桌面歌词修复</h3>
      <p>修复锁定后按钮无法点击、无法关闭的问题。现在锁定只固定歌词位置，背景、解锁和关闭按钮仍可使用，锁定时按钮保持显示。播放器内也提供解锁和关闭入口。</p>
      <p>旧版 Windows 客户端会提示下载新版，不再误用浏览器画中画功能。请安装 Windows 1.1.1 使窗口修复生效。</p>
      <h3>歌手歌曲，一键播放</h3>
      <p>歌手页新增「播放全部」，分页读取歌手曲库，最多加载前 500 首中的可播放歌曲。原来的「播放热门歌曲」继续保留。加载可以取消，失败或取消时保留原播放列表。</p>
      <p>歌手页功能刷新后即可使用。安卓安装包继续为 1.1.0，本次无需重新安装。</p>
      <div className="release-downloads">
        {packages?.android && <a className="btn sm" href={packages.android.url} download>下载安卓 {packages.android.version}</a>}
        {packages?.windows && <a className="btn ghost sm" href={packages.windows.url} download>下载 Windows {packages.windows.version}</a>}
      </div>
      <p className="sub sm">Windows 可覆盖安装更新，请按系统提示完成安装。</p>
    </div>
  </Sheet>;
}

export function ReleaseNotice({ userId }: { userId: number }) {
  const [show, setShow] = useState(false);
  const [details, setDetails] = useState(false);
  const key = `nt-announcement-${RELEASE}-${userId}`;
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    try { if (localStorage.getItem(key)) return; } catch { /* Show for this visit. */ }
    const appear = () => {
      if (disposed) return;
      if (document.visibilityState !== 'visible' || document.querySelector('.pwa-intro,.pwa-update,.sheet-layer')) { timer = setTimeout(appear, 2500); return; }
      setShow(true);
    };
    timer = setTimeout(appear, 2400);
    return () => { disposed = true; clearTimeout(timer); };
  }, [key]);
  const dismiss = () => { setShow(false); try { localStorage.setItem(key, 'seen'); } catch { /* Optional preference. */ } };
  return <>
    {show && <section className="release-notice" aria-labelledby="release-title">
      <span className="release-icon" aria-hidden="true"><Icon n="lyrics" s={22} /></span>
      <div><div className="sub sm">Nestune 更新公告</div><h2 id="release-title">桌面歌词修复，歌手曲库一键播放</h2><p className="sub sm">修复 Windows 歌词锁定和旧版兼容问题，新增歌手「播放全部」。</p>
        <div className="row"><button className="btn sm" onClick={() => { dismiss(); setDetails(true); }}>查看更新</button><button className="link" onClick={dismiss}>知道了</button></div>
      </div>
      <button type="button" className="ib release-dismiss" aria-label="关闭更新公告" onClick={dismiss}><Icon n="x" s={16} /></button>
    </section>}
    {details && <ReleaseNotes onClose={() => setDetails(false)} />}
  </>;
}
