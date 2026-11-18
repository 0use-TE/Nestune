'use client';
import { useEffect, useState } from 'react';
import { LATEST_RELEASE, RELEASE_NOTES, type ReleaseNote } from '@/lib/release-notes';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

function ReleaseImages({ images }: { images: ReleaseNote['images'] }) {
  if (!images?.length) return null;
  return <div className="release-images">
    {images.map(image => <img key={image.src} src={image.src} alt={image.alt}
      width={image.width} height={image.height} loading="lazy" decoding="async" />)}
  </div>;
}

export function ReleaseNotes({ onClose }: { onClose: () => void }) {
  const [releases, setReleases] = useState(RELEASE_NOTES);
  useEffect(() => {
    let alive = true;
    fetch('/api/release-notes', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(data => {
      if (alive && Array.isArray(data?.releases) && data.releases.length) setReleases(data.releases);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const latest = releases[0];
  return <Sheet title="更新公告" onClose={onClose} className="release-sheet">
    <div className="release-notes">
      <p className="sub sm">Nestune {latest.version} · {latest.date}</p>
      {latest.sections.map(section => <section key={section.title}>
        <h3>{section.title}</h3>{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </section>)}
      <ReleaseImages images={latest.images} />
      <div className="release-downloads">
        <a className="btn sm" href="/downloads">下载客户端</a>
      </div>
      <p className="sub sm">网页功能更新无需安装；系统功能需更新客户端。旧版请先用系统浏览器手动下载并覆盖安装，之后可使用支持的平台内置更新。</p>
      {releases.slice(1).map(release => <details key={release.version}>
        <summary>历史更新 · {release.version} · {release.title}</summary>
        <p className="sub sm">{release.date}</p>
        {release.sections.map(section => <section key={section.title}>
          <h3>{section.title}</h3>{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        </section>)}
        <ReleaseImages images={release.images} />
      </details>)}
    </div>
  </Sheet>;
}

export function ReleaseNotice({ userId }: { userId: number }) {
  const [show, setShow] = useState(false);
  const [details, setDetails] = useState(false);
  const key = `nt-announcement-${LATEST_RELEASE.version}-${userId}`;
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
      <div><div className="sub sm">Nestune {LATEST_RELEASE.version} 更新公告</div><h2 id="release-title">{LATEST_RELEASE.title}</h2><p className="sub sm">{LATEST_RELEASE.summary}</p>
        <div className="row"><button className="btn sm" onClick={() => { dismiss(); setDetails(true); }}>查看更新</button><button className="link" onClick={dismiss}>知道了</button></div>
      </div>
      <button type="button" className="ib release-dismiss" aria-label="关闭更新公告" onClick={dismiss}><Icon n="x" s={16} /></button>
    </section>}
    {details && <ReleaseNotes onClose={() => setDetails(false)} />}
  </>;
}
