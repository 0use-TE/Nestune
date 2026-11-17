import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { clientDownloads, clientDownloadUrl, clientPackageLabel, DOWNLOAD_PLATFORMS, groupClientDownloads, type ClientDownload, type DownloadPlatform } from '@/server/client-downloads';
import styles from './page.module.css';
import { DownloadHelp } from './DownloadHelp';

export const metadata: Metadata = { title: 'Nestune 客户端下载' };
export const dynamic = 'force-dynamic';

const platforms = Object.keys(DOWNLOAD_PLATFORMS) as DownloadPlatform[];
const platformInfo = {
  windows: { sub: 'Windows 10 / 11', variants: [{ arch: 'x64', label: 'x64' }, { arch: 'arm64', label: 'ARM64' }] },
  linux: { sub: 'AppImage · DEB', variants: [{ arch: 'x64', label: 'x64' }] },
  macos: { sub: 'Apple 芯片 · Intel', variants: [{ arch: 'universal', label: 'Universal' }] },
  android: { sub: 'Android 7 及以上', variants: [{ arch: 'universal', label: '通用 APK' }] },
};

const archLabel = (architecture: string) => architecture === 'arm64' ? 'ARM64' : architecture === 'universal' ? 'Universal' : architecture;

function PlatformIcon({ platform }: { platform: DownloadPlatform }) {
  return <span className={styles.platformIcon} data-platform={platform} aria-hidden="true" />;
}

function DownloadRow({ download }: { download: ClientDownload }) {
  return <li className={styles.package}>
    <div>
      <strong>V{download.version}</strong>
      <span className={styles.meta}>{archLabel(download.architecture)} · {clientPackageLabel(download)} · {(download.size / 1_048_576).toFixed(1)} MiB{download.origin === 'music' && ' · 旧入口'}</span>
      <details className={styles.checksum}><summary>SHA-256</summary><code>{download.sha256}</code></details>
    </div>
    <a className={styles.download} href={clientDownloadUrl(download.filename)} download aria-label={`${DOWNLOAD_PLATFORMS[download.platform]} ${archLabel(download.architecture)} ${download.version} ${clientPackageLabel(download)}`}><Icon n="download" s={15} />{clientPackageLabel(download)}</a>
  </li>;
}

function DownloadList({ downloads }: { downloads: ClientDownload[] }) {
  return <ul className={styles.packages}>{downloads.map(download => <DownloadRow key={download.filename} download={download} />)}</ul>;
}

export default async function DownloadsPage({ searchParams }: { searchParams: Promise<{ from?: string; history?: string }> }) {
  const options = await searchParams;
  const migration = options.from === 'music';
  const showHistory = options.history === '1';
  const { latest, history } = groupClientDownloads(clientDownloads());
  const migrationLink = `/downloads?from=music${showHistory ? '&history=1' : ''}#migration`;
  const historyLink = `/downloads?history=1${migration ? '&from=music' : ''}#history`;
  return <main className={styles.page}>
    <div className={styles.content}>
      <header className={styles.heading}>
        <div className={styles.identity}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pwa/icon-192.png" width="54" height="54" alt="" />
          <h1>下载 Nestune</h1>
        </div>
        <div className={styles.actions}>
          <Link href="/" className={styles.webButton}>打开网页版</Link>
          <Link href={migrationLink} className={styles.migrateButton} prefetch={false}>进行迁移 <span aria-hidden="true">→</span></Link>
        </div>
      </header>
      {migration && <section className={styles.migration} id="migration" aria-labelledby="migration-title">
        <h2 id="migration-title">从 music.0use.net 迁移</h2>
        <p>新地址是 <Link href="/">https://nestune.0use.net:8443</Link>。继续使用原账号登录，服务器上的收藏、歌单和上传歌曲会保留。</p>
        <dl>
          <div><dt>浏览器和已安装的网页应用</dt><dd>用浏览器打开新地址，再从浏览器菜单「安装应用」或「添加到主屏幕」。确认新图标能打开后，可以移除旧图标。</dd></div>
          <div><dt>Windows、Linux、macOS 和 Android 客户端</dt><dd>下载下面适配新地址的安装包，关闭旧客户端后安装。安装完成后重新打开客户端并登录。</dd></div>
        </dl>
      </section>}
      <DownloadHelp href={migration ? '/downloads?from=music' : '/downloads'} />
      <div className={styles.platforms}>
        {platforms.map(platform => {
          const info = platformInfo[platform];
          const current = latest.filter(download => download.platform === platform);
          const variants = [...info.variants];
          for (const download of current) if (!variants.some(variant => variant.arch === download.architecture)) {
            variants.push({ arch: download.architecture, label: archLabel(download.architecture) });
          }
          return <section className={styles.platform} data-platform={platform} key={platform} id={platform} aria-labelledby={`title-${platform}`}>
            <div className={styles.platformHeading}>
              <PlatformIcon platform={platform} />
              <div><h2 id={`title-${platform}`}>{DOWNLOAD_PLATFORMS[platform]}</h2><p>{info.sub}</p></div>
            </div>
            <ul className={styles.variants} aria-label={`${DOWNLOAD_PLATFORMS[platform]} 安装包`}>
              {variants.map(({ arch, label }) => {
                const packages = current.filter(download => download.architecture === arch);
                return <li key={arch} className={styles.variant} data-arch={arch}>
                  <div className={styles.variantName}><strong>{label}</strong>{packages[0] && <span>V{packages[0].version}</span>}</div>
                  {packages.length ? <div className={styles.packageActions}>{packages.map(download => (
                    <a className={styles.download} key={download.filename} href={clientDownloadUrl(download.filename)} download
                      aria-label={`${DOWNLOAD_PLATFORMS[platform]} ${archLabel(arch)} ${download.version} ${clientPackageLabel(download)}`}
                      title={platform === 'windows' ? clientPackageLabel(download) === '安装版' ? '安装后使用，包含快捷方式和卸载程序' : '免安装，下载后直接运行' : download.filename}>
                      <Icon n="download" s={15} />{clientPackageLabel(download)}
                    </a>
                  ))}</div> : <span className={styles.pending}>待发布</span>}
                </li>;
              })}
            </ul>
          </section>;
        })}
      </div>
      {history.length > 0 && <div className={styles.historyToggle}>
        <Link href={showHistory ? (migration ? '/downloads?from=music' : '/downloads') : historyLink} prefetch={false}>
          {showHistory ? '收起历史版本' : '查看历史版本'} <span aria-hidden="true">{showHistory ? '↑' : '↓'}</span>
        </Link>
      </div>}
      {showHistory && history.length > 0 && <section className={styles.history} id="history" aria-labelledby="history-title">
        <h2 id="history-title">历史版本</h2>
        {history.some(download => download.origin === 'music') && <p className={styles.meta}>旧入口版本用于归档。迁移时请选择各平台最新安装包。</p>}
        <div className={styles.archive}>
          {platforms.map(platform => {
            const entries = history.filter(download => download.platform === platform);
            return entries.length > 0 && <div key={platform} className={styles.archivePlatform}>
              <h3>{DOWNLOAD_PLATFORMS[platform]}</h3>
              <DownloadList downloads={entries} />
            </div>;
          })}
        </div>
      </section>}
    </div>
  </main>;
}
