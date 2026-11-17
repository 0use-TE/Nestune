'use client';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import type { AndroidRelease, WindowsRelease } from '@/server/client-updates';

const RELEASE = 'lyrics-volume-1.1.0';
export function ReleaseNotes({ onClose }: { onClose: () => void }) {
  const [packages, setPackages] = useState<{ android: AndroidRelease | null; windows: WindowsRelease | null } | null>(null);
  useEffect(() => { let alive = true; fetch('/api/client-updates', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(data => { if (alive) setPackages(data); }).catch(() => {}); return () => { alive = false; }; }, []);
  return <Sheet title="更新公告" onClose={onClose} className="release-sheet">
    <div className="release-notes">
      <p className="sub sm">Nestune 1.1.0 · 2026 年 11 月 17 日</p>
      <h3>把歌词留在桌面</h3>
      <p>Windows 客户端支持独立、透明、置顶的歌词窗，可以拖动位置、切换背景，锁定后鼠标可穿透操作下面的应用。解锁入口在「个人设置 → 偏好」。</p>
      <p>安卓客户端开启「显示在其他应用上层」权限后，切到桌面或其他应用也能看歌词。拖动文字可移动，轻点文字可显示背景、锁定和关闭按钮。</p>
      <p>支持画中画的电脑浏览器也可以弹出歌词窗口。歌词、翻译和暂停、切歌、拖动进度同步更新。</p>
      <h3>声音大小，自己决定</h3>
      <p>播放器新增音量按钮，支持调节音量和一键静音，再次打开会记住设置。手机可在完整播放器或「个人设置 → 偏好」调整。</p>
      <h3>整张歌单，轻松接着听</h3>
      <p>「我的歌单」卡片新增加号，详情页也可一键加入播放列表。电脑拖动歌单、手机长按后拖到下方提示区，都能把整单歌曲接到当前队列末尾，并展开播放列表。正在播放的歌曲和进度会保留。</p>
      <h3>如何使用</h3>
      <p>更新客户端后，在完整播放器点「桌面歌词」，或打开原来的悬浮歌词，再点右上角的「移到桌面」。网页音量功能刷新后即可使用。</p>
      <div className="release-downloads">
        {packages?.android && <a className="btn sm" href={packages.android.url} download>下载安卓 {packages.android.version}</a>}
        {packages?.windows && <a className="btn ghost sm" href={packages.windows.url} download>下载 Windows {packages.windows.version}</a>}
      </div>
      <p className="sub sm">安卓更新沿用原签名，可以覆盖安装。请按系统提示安装更新。</p>
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
      <div><div className="sub sm">Nestune 更新公告</div><h2 id="release-title">歌词可以留在桌面了</h2><p className="sub sm">新增桌面歌词、音量调节和歌单整单入队。</p>
        <div className="row"><button className="btn sm" onClick={() => { dismiss(); setDetails(true); }}>查看更新</button><button className="link" onClick={dismiss}>知道了</button></div>
      </div>
      <button type="button" className="ib release-dismiss" aria-label="关闭更新公告" onClick={dismiss}><Icon n="x" s={16} /></button>
    </section>}
    {details && <ReleaseNotes onClose={() => setDetails(false)} />}
  </>;
}
