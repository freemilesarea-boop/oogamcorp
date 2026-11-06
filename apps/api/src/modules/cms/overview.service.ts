import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PagesService } from './pages.service';

type Counts = Record<'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED', number>;
const emptyCounts = (): Counts => ({ DRAFT: 0, REVIEW: 0, PUBLISHED: 0, ARCHIVED: 0 });

@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pages: PagesService,
  ) {}

  async get(auth: AuthContext) {
    const org = auth.organizationId;
    const base = { organizationId: org, deletedAt: null };
    const [brandGroups, portfolioGroups, postGroups, reviewBrands, reviewPosts, reviewPortfolio, pages] = await Promise.all([
      this.prisma.brand.groupBy({ by: ['status'], where: base, _count: true }),
      this.prisma.portfolioItem.groupBy({ by: ['status'], where: base, _count: true }),
      this.prisma.websitePost.groupBy({ by: ['type', 'status'], where: base, _count: true }),
      this.prisma.brand.findMany({ where: { ...base, status: 'REVIEW' }, select: { id: true, name: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 10 }),
      this.prisma.websitePost.findMany({ where: { ...base, status: 'REVIEW' }, select: { id: true, title: true, type: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 10 }),
      this.prisma.portfolioItem.findMany({ where: { ...base, status: 'REVIEW' }, select: { id: true, title: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 10 }),
      this.pages.list(auth),
    ]);
    const toCounts = (groups: { status: keyof Counts; _count: number }[]) =>
      groups.reduce((acc, g) => ({ ...acc, [g.status]: acc[g.status] + g._count }), emptyCounts());
    const posts = { NEWS: emptyCounts(), INSIGHT: emptyCounts(), CAREER: emptyCounts() };
    for (const g of postGroups) posts[g.type][g.status] += g._count;

    const pending = [
      ...reviewBrands.map((b) => ({ kind: 'brand' as const, id: b.id, title: b.name, updatedAt: b.updatedAt, href: '/admin/cms/brands' })),
      ...reviewPortfolio.map((p) => ({ kind: 'portfolio' as const, id: p.id, title: p.title, updatedAt: p.updatedAt, href: '/admin/cms/brands?tab=portfolio' })),
      ...reviewPosts.map((p) => ({ kind: 'post' as const, id: p.id, title: p.title, postType: p.type, updatedAt: p.updatedAt, href: `/admin/cms/posts?type=${p.type}` })),
      ...pages.filter((p) => p.exists && p.hasUnpublishedChanges).map((p) => ({ kind: 'page' as const, id: p.id!, title: p.title, updatedAt: p.updatedAt!, href: `/admin/cms/pages?key=${p.key}` })),
    ].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

    let inquiries: { newCount: number; recent: { id: string; name: string; category: string; status: string; createdAt: Date }[] } | null = null;
    if (auth.permissions.has('cms.inquiries')) {
      const [newCount, recent] = await Promise.all([
        this.prisma.contactInquiry.count({ where: { organizationId: org, status: 'NEW' } }),
        this.prisma.contactInquiry.findMany({
          where: { organizationId: org }, orderBy: { createdAt: 'desc' }, take: 5,
          select: { id: true, name: true, category: true, status: true, createdAt: true },
        }),
      ]);
      inquiries = { newCount, recent };
    }

    return {
      brands: toCounts(brandGroups),
      portfolio: toCounts(portfolioGroups),
      posts,
      pages: pages.map((p) => ({ key: p.key, title: p.title, status: p.status, exists: p.exists, hasUnpublishedChanges: p.hasUnpublishedChanges })),
      pending,
      inquiries,
      canPublish: auth.permissions.has('cms.publish'),
    };
  }
}
