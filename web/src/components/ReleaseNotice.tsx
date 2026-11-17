'use client';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import type { AndroidRelease, WindowsRelease } from '@/server/client-updates';

const RELEASE = 'karaoke-1.2.1';
export function ReleaseNotes({ onClose }: { onClose: () => void }) {
  const [packages, setPackages] = useState<{ android: AndroidRelease | null; windows: WindowsRelease | null } | null>(null);
  useEffect(() => { let alive = true; fetch('/api/client-updates', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(data => { if (alive) setPackages(data); }).catch(() => {}); return () => { alive = false; }; }, []);
  return <Sheet title="更新公告" onClose={onClose} className="release-sheet">
    <div className="release-notes">
      <p className="sub sm">Nestune 1.2.1 · 2026 年 11 月 17 日</p>
      <h3>蓝黄流光，跟着歌词走</h3>
      <p>播放器和应用内悬浮歌词新增逐字扫色，已唱部分用蓝—黄—蓝渐变覆盖。每句的起始颜色、方向和流速会变化，暂停时一起停住，拖动进度后立即同步。</p>
      <p>有逐字时间的音源按实际演唱位置显示；只有整句时间的歌曲使用平滑的估算扫色。翻译、长句换行和明暗配色保持原有风格。</p>
      <p>播放器和应用内浮窗刷新后即可使用。系统独立悬浮窗的流光效果将随新版 Windows 和安卓安装包提供。</p>
      <h3>QQ 音乐与网易云，一起听</h3>
      <p>同一录音在搜索中显示一行，行尾列出网易云和 QQ 音乐来源。现场、翻唱、伴奏和重制等版本各自保留。</p>
      <p>播放器可以手动切换音源，在设置中也能选择优先平台。切源保留播放进度，歌词跟随当前来源；收藏、歌单和画布兼容原有歌曲。QQ 音乐本次支持在线播放，是否可播放取决于音源账号的实际权限。</p>
      <p>音乐库新增收藏卡片，打开「我的喜欢」即可将全部歌曲添加到一张歌单。</p>
      <div className="release-downloads">
        {packages?.android && <a className="btn sm" href={packages.android.url} download>下载安卓 {packages.android.version}</a>}
        {packages?.windows && <a className="btn ghost sm" href={packages.windows.url} download>下载 Windows {packages.windows.version}</a>}
      </div>
      <p className="sub sm">浏览器访问当前网站即可使用这些功能。</p>
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
      <div><div className="sub sm">Nestune 更新公告</div><h2 id="release-title">歌词跟随演唱，蓝黄流光扫色</h2><p className="sub sm">新增逐字高亮和随机流光，保留双音源搜索与切换。</p>
        <div className="row"><button className="btn sm" onClick={() => { dismiss(); setDetails(true); }}>查看更新</button><button className="link" onClick={dismiss}>知道了</button></div>
      </div>
      <button type="button" className="ib release-dismiss" aria-label="关闭更新公告" onClick={dismiss}><Icon n="x" s={16} /></button>
    </section>}
    {details && <ReleaseNotes onClose={() => setDetails(false)} />}
  </>;
}
