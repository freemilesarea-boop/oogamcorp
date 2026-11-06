import 'server-only';
import type { Metadata } from 'next';
import { cache } from 'react';
import { publicFetch } from '@/lib/server-api';
import type {
  GenericContent, HomeData, PostType, PublicBrand, PublicPage, PublicPaginated, PublicPortfolioItem, PublicPost, Seo, SiteInfo, SitemapData,
} from './types';

/** 공개 API 조회 (null = API 불가/미게시). 가짜 데이터로 대체하지 않는다. */
export const getSite = cache(() => publicFetch<SiteInfo>('/site'));
export const getHome = cache(() => publicFetch<HomeData>('/home'));
export const getPage = cache(<C = GenericContent>(key: string) => publicFetch<PublicPage<C>>(`/pages/${encodeURIComponent(key)}`));
export const getBrands = cache(() => publicFetch<PublicBrand[]>('/brands'));
export const getBrand = cache((slug: string) =>
  publicFetch<PublicBrand & { portfolio: PublicPortfolioItem[] }>(`/brands/${encodeURIComponent(slug)}`),
);
export const getPortfolio = cache(() => publicFetch<PublicPortfolioItem[]>('/portfolio'));
export const getPosts = cache((type: PostType | undefined, page = 1, pageSize = 12) => {
  const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (type) sp.set('type', type);
  return publicFetch<PublicPaginated<PublicPost>>(`/posts?${sp.toString()}`);
});
export const getPost = cache((type: PostType, slug: string) => publicFetch<PublicPost>(`/posts/${type}/${encodeURIComponent(slug)}`));
export const getSitemap = () => publicFetch<SitemapData>('/sitemap');

/** CMS SEO 필드 → Next Metadata (OpenGraph 포함) */
export function seoMetadata(opts: { seo?: Partial<Seo> | null; fallbackTitle: string; fallbackDescription?: string; path: string; image?: string | null; type?: 'website' | 'article' }): Metadata {
  const title = opts.seo?.title || opts.fallbackTitle;
  const description = opts.seo?.description || opts.fallbackDescription;
  const image = opts.seo?.ogImageUrl || opts.image || undefined;
  return {
    title: { absolute: title.includes('OOGAM') ? title : `${title} | OOGAM` },
    description,
    alternates: { canonical: opts.path },
    openGraph: {
      title, description, url: opts.path, type: opts.type ?? 'website', siteName: 'OOGAM', locale: 'ko_KR',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description },
  };
}

/** 첫 문단을 메타 설명으로 */
export function excerptOf(text: string | null | undefined, max = 150): string | undefined {
  if (!text) return undefined;
  const plain = text.replace(/[#*_`>\[\]()-]/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain || undefined;
}
