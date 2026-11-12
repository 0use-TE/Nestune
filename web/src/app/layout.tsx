import type { Metadata, Viewport } from 'next';
import { PwaProvider } from '@/components/Pwa';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nestune', description: '私人音乐库', applicationName: 'Nestune',
  appleWebApp: { capable: true, title: 'Nestune', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/pwa/favicon-16.png?v=2', sizes: '16x16', type: 'image/png' },
      { url: '/pwa/favicon-32.png?v=2', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.ico?v=2', sizes: '16x16 32x32 48x48 256x256', type: 'image/x-icon' },
    ],
    shortcut: '/favicon.ico?v=2',
    apple: [{ url: '/pwa/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#fbfaf8' }, { media: '(prefers-color-scheme: dark)', color: '#0f0f0e' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body><PwaProvider>{children}</PwaProvider></body>
    </html>
  );
}
