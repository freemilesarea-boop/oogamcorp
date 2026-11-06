import type { MetadataRoute } from 'next';
import { getSitemap } from '@/components/site/data';
import { siteUrl } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const PAGE_PATHS: Record<string, string> = {
  home: '/', about: '/about', business: '/business', careers: '/careers', contact: '/contact', privacy: '/privacy', terms: '/terms',
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await getSitemap();
  const url = (p: string) => new URL(p, siteUrl).toString();
  const staticEntries: MetadataRoute.Sitemap = ['/', '/brands', '/portfolio', '/news', '/careers', '/contact'].map((p) => ({
    url: url(p), changeFrequency: 'weekly', priority: p === '/' ? 1 : 0.7,
  }));
  if (!data) return staticEntries;
  const seen = new Set(staticEntries.map((e) => e.url));
  const out = [...staticEntries];
  const push = (e: MetadataRoute.Sitemap[number]) => {
    if (seen.has(e.url)) {
      const idx = out.findIndex((o) => o.url === e.url);
      out[idx] = { ...out[idx], lastModified: e.lastModified };
      return;
    }
    seen.add(e.url);
    out.push(e);
  };
  for (const p of data.pages) if (PAGE_PATHS[p.key]) push({ url: url(PAGE_PATHS[p.key]), lastModified: p.updatedAt, changeFrequency: 'monthly', priority: 0.6 });
  for (const b of data.brands) push({ url: url(`/brands/${encodeURIComponent(b.slug)}`), lastModified: b.updatedAt, changeFrequency: 'monthly', priority: 0.6 });
  for (const p of data.posts) {
    const path = p.type === 'CAREER' ? `/careers/${encodeURIComponent(p.slug)}` : `/news/${encodeURIComponent(p.slug)}`;
    push({ url: url(path), lastModified: p.updatedAt, changeFrequency: 'monthly', priority: 0.5 });
  }
  return out;
}
