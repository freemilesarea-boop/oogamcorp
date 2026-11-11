import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PreviewBadge } from '@/components/preview-badge';
import { isPreview } from '@/lib/site-mode';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'OOGAM — Ideas Become Impact.', template: '%s | OOGAM' },
  description: 'OOGAM — AI Education. AI Music Media. AI Technology.',
  openGraph: { siteName: 'OOGAM', locale: 'ko_KR', type: 'website' },
  // Preview 빌드는 검색엔진 색인 금지 (Nginx X-Robots-Tag 와 이중 적용)
  ...(isPreview ? { robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } } } : {}),
};

export const viewport: Viewport = { themeColor: '#0a0a0a', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body>
        {children}
        <PreviewBadge />
      </body>
    </html>
  );
}
