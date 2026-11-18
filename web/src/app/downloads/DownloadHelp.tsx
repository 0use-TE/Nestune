'use client';

import { useState } from 'react';
import styles from './page.module.css';

export function DownloadHelp({ href }: { href: string }) {
  const [status, setStatus] = useState('');
  const [manualUrl, setManualUrl] = useState('');

  async function copyLink() {
    const url = new URL(href, window.location.href).href;
    try {
      await navigator.clipboard.writeText(url);
      setManualUrl('');
      setStatus('下载页链接已复制，请粘贴到系统浏览器中打开。');
    } catch {
      setManualUrl(url);
      setStatus('无法自动复制，请长按或选中下面的链接复制到浏览器。');
    }
  }

  return <aside className={styles.downloadHelp} aria-label="下载帮助">
    <p>点击下载没反应？请在系统浏览器中打开下载页。</p>
    <div className={styles.actions}>
      <a className={styles.webButton} href={href} target="_blank" rel="noopener noreferrer">在浏览器打开下载</a>
      <button className={styles.webButton} type="button" onClick={() => void copyLink()}>复制下载页链接</button>
    </div>
    <p className={styles.helpHint}>如果仍停留在客户端内，请复制链接后用浏览器打开。</p>
    <p role="status">{status}</p>
    {manualUrl && <input className={styles.copyUrl} aria-label="下载页链接" value={manualUrl} readOnly onFocus={event => event.currentTarget.select()} />}
  </aside>;
}
