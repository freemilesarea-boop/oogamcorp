/** 공개 홈페이지 API (/api/v1/public/*) 응답 타입 */

export interface Seo {
  title: string | null;
  description: string | null;
  ogImageUrl: string | null;
}

export interface LinkItem {
  label?: string;
  href?: string;
}

export interface Area {
  key?: string;
  title?: string;
  body?: string;
}

export interface HomeContent {
  hero?: { eyebrow?: string; title?: string; lines?: string[]; ctaLabel?: string; ctaHref?: string };
  intro?: { heading?: string; body?: string };
  business?: Area[];
  cta?: { heading?: string; label?: string; href?: string };
}

export interface GenericContent {
  heading?: string;
  body?: string;
  values?: { title?: string; body?: string }[];
  areas?: Area[];
  email?: string;
  phone?: string;
  address?: string;
  effectiveDate?: string;
}

export interface SiteSettings {
  companyName?: string;
  ceo?: string;
  businessNumber?: string;
  address?: string;
  email?: string;
  phone?: string;
  tagline?: string;
  copyright?: string;
  socials?: LinkItem[];
}

export interface PublicPage<C = GenericContent> {
  key: string;
  title: string;
  content: C;
  seo: Seo;
  publishedAt: string | null;
  updatedAt: string;
}

export interface SiteInfo {
  name: string;
  nav: { href: string; label: string }[];
  footer: SiteSettings | null;
  seo: Seo;
}

export interface PublicBrand {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  imageUrl: string | null;
  websiteUrl: string | null;
  category: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
}

export interface PublicPortfolioItem {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body?: string | null;
  client: string | null;
  year: number | null;
  imageUrl: string | null;
  tags: string[];
  featured: boolean;
  brand?: { id: string; slug: string; name: string } | null;
}

export type PostType = 'NEWS' | 'INSIGHT' | 'CAREER';

export interface CareerMeta {
  location?: string;
  employmentType?: string;
  deadline?: string;
  team?: string;
  experience?: string;
  applyUrl?: string;
}

export interface PublicPost {
  id: string;
  type: PostType;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  metadata: CareerMeta;
  publishedAt: string;
  updatedAt: string;
  body?: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export interface PublicPaginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 사업 영역 (CMS business_areas). 목록 응답에는 body 가 없다 */
export interface PublicBusinessArea {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  body?: string | null;
  imageUrl: string | null;
  highlights: string[];
  ctaLabel: string | null;
  ctaHref: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
}

export interface HomeData {
  page: PublicPage<HomeContent> | null;
  businessAreas?: PublicBusinessArea[];
  brands: PublicBrand[];
  featured: PublicPortfolioItem[];
  news: PublicPost[];
}

export interface SitemapData {
  pages: { key: string; updatedAt: string }[];
  brands: { slug: string; updatedAt: string }[];
  businessAreas?: { slug: string; updatedAt: string }[];
  posts: { type: PostType; slug: string; updatedAt: string }[];
}

export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: '정규직', CONTRACT: '계약직', PART_TIME: '파트타임', INTERN: '인턴', FREELANCE: '프리랜서',
};

export const POST_TYPE_LABELS: Record<PostType, string> = { NEWS: 'News', INSIGHT: 'Insight', CAREER: 'Careers' };
