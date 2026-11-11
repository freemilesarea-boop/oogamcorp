import type { ContentStatus } from '@oogam/shared';

export type { ContentStatus };
export type PostType = 'NEWS' | 'INSIGHT' | 'CAREER';
export type InquiryStatus = 'NEW' | 'IN_PROGRESS' | 'RESOLVED' | 'SPAM';

export interface Brand {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  imageUrl: string | null;
  websiteUrl: string | null;
  category: string | null;
  relationshipNote: string | null;
  sortOrder: number;
  status: ContentStatus;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
  _count?: { portfolioItems: number };
}

export interface PortfolioItem {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body: string | null;
  client: string | null;
  year: number | null;
  imageUrl: string | null;
  brandId: string | null;
  brand: { id: string; name: string; slug: string; status: ContentStatus } | null;
  tags: string[];
  featured: boolean;
  sortOrder: number;
  status: ContentStatus;
  publishedAt: string | null;
  updatedAt: string;
}

export interface Post {
  id: string;
  type: PostType;
  slug: string;
  title: string;
  excerpt: string | null;
  body?: string;
  coverImageUrl: string | null;
  metadata: Record<string, string>;
  status: ContentStatus;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
  author: { id: string; name: string } | null;
}

export interface PageSummary {
  key: string;
  exists: boolean;
  id: string | null;
  title: string;
  status: ContentStatus;
  publishedAt: string | null;
  updatedAt: string | null;
  hasUnpublishedChanges: boolean;
}

export interface PageDetail extends PageSummary {
  content: Record<string, unknown>;
  publishedContent: Record<string, unknown> | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
}

export interface InquiryRow {
  id: string;
  name: string;
  email: string;
  company: string | null;
  category: string;
  status: InquiryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InquiryDetail extends InquiryRow {
  phone: string | null;
  message: string;
  consentAt: string;
  userAgent: string | null;
  internalNote: string | null;
  handledBy: { id: string; name: string } | null;
}

type Counts = Record<ContentStatus, number>;
export interface Overview {
  brands: Counts;
  portfolio: Counts;
  posts: Record<PostType, Counts>;
  pages: { key: string; title: string; status: ContentStatus; exists: boolean; hasUnpublishedChanges: boolean }[];
  pending: { kind: 'brand' | 'portfolio' | 'post' | 'page'; id: string; title: string; updatedAt: string; href: string; postType?: PostType }[];
  inquiries: { newCount: number; recent: { id: string; name: string; category: string; status: InquiryStatus; createdAt: string }[] } | null;
  canPublish: boolean;
}

export const POST_TYPE_LABELS: Record<PostType, string> = { NEWS: '뉴스', INSIGHT: '인사이트', CAREER: '채용' };
export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = { NEW: '신규', IN_PROGRESS: '처리 중', RESOLVED: '완료', SPAM: '스팸' };
export const INQUIRY_CATEGORY_LABELS: Record<string, string> = {
  PROJECT: '프로젝트', PARTNERSHIP: '제휴·파트너십', CAREER: '채용', PRESS: '언론', GENERAL: '기타',
};
export const EMPLOYMENT_TYPES: { value: string; label: string }[] = [
  { value: 'FULL_TIME', label: '정규직' }, { value: 'CONTRACT', label: '계약직' }, { value: 'PART_TIME', label: '파트타임' },
  { value: 'INTERN', label: '인턴' }, { value: 'FREELANCE', label: '프리랜서' },
];

export interface BusinessArea {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  body: string | null;
  imageUrl: string | null;
  highlights: string[];
  ctaLabel: string | null;
  ctaHref: string | null;
  sortOrder: number;
  status: ContentStatus;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
}
