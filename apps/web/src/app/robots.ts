import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/server-api';
import { isPreview } from '@/lib/site-mode';

export default function robots(): MetadataRoute.Robots {
  // Preview: 전체 크롤링 차단
  if (isPreview) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/admin/', '/api/'] }],
    sitemap: new URL('/sitemap.xml', siteUrl).toString(),
    host: siteUrl,
  };
}
