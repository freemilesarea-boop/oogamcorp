/**
 * 정적 사이트 스냅샷(apps/web/src/lib/static-site/snapshot.json) → CMS DB 초기 콘텐츠.
 * CMS 모드로 전환할 때 현재 공개 중인 홈페이지가 비지 않도록 1회 실행한다.
 *
 *   DATABASE_URL=… npx tsx prisma/import-static-snapshot.ts
 *
 * - 고정 페이지·사업 영역: 현재 공개 상태 그대로 게시(PUBLISHED)로 가져온다 ([샘플 문구] 표시 유지).
 * - 가상 샘플 브랜드·포트폴리오·뉴스·채용: 실제 기업 정보와 구분하기 위해 초안(DRAFT)으로만 가져온다.
 *   브랜드에는 "가상 샘플" 관계 메모를 남겨 게시 시 확인 절차를 거치게 한다.
 * - 이미 같은 키/슬러그가 있으면 건너뛴다 (재실행 안전).
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient();
const PAGE_TITLES: Record<string, string> = {
  home: '홈', about: '회사 소개', business: '사업 영역', careers: '채용', contact: '문의', privacy: '개인정보처리방침', terms: '이용약관',
};

async function main() {
  const snap = JSON.parse(readFileSync(join(__dirname, '../../web/src/lib/static-site/snapshot.json'), 'utf8')) as Any;
  const org = await prisma.organization.findUniqueOrThrow({ where: { slug: process.env.SITE_ORG_SLUG || 'oogam' } });
  const now = new Date();
  const counts = { pages: 0, areas: 0, brands: 0, portfolio: 0, posts: 0 };

  for (const [key, page] of Object.entries(snap.pages as Record<string, Any>)) {
    if (await prisma.websitePage.findUnique({ where: { organizationId_key: { organizationId: org.id, key } } })) continue;
    const content = page.content as Prisma.InputJsonValue;
    await prisma.websitePage.create({
      data: {
        organizationId: org.id, key, title: PAGE_TITLES[key] ?? page.title, content, publishedContent: content, status: 'PUBLISHED',
        seoTitle: page.seo?.title ?? null, seoDescription: page.seo?.description ?? null, ogImageUrl: page.seo?.ogImageUrl ?? null, publishedAt: now,
      },
    });
    counts.pages++;
  }

  for (const [i, a] of (snap.businessAreas as Any[]).entries()) {
    if (await prisma.businessArea.findUnique({ where: { organizationId_slug: { organizationId: org.id, slug: a.slug } } })) continue;
    await prisma.businessArea.create({
      data: {
        organizationId: org.id, slug: a.slug, title: a.title, subtitle: a.subtitle, summary: a.summary, body: a.body, imageUrl: a.imageUrl,
        highlights: a.highlights ?? [], ctaLabel: a.ctaLabel, ctaHref: a.ctaHref, sortOrder: i, status: 'PUBLISHED', publishedAt: now,
      },
    });
    counts.areas++;
  }

  const brandIds = new Map<string, string>();
  for (const [i, b] of (snap.brands as Any[]).entries()) {
    const existing = await prisma.brand.findUnique({ where: { organizationId_slug: { organizationId: org.id, slug: b.slug } } });
    if (existing) { brandIds.set(b.slug, existing.id); continue; }
    const created = await prisma.brand.create({
      data: {
        organizationId: org.id, slug: b.slug, name: b.name, tagline: b.tagline, description: b.description, logoUrl: b.logoUrl, imageUrl: b.imageUrl,
        websiteUrl: b.websiteUrl, category: b.category, sortOrder: i, status: 'DRAFT',
        relationshipNote: '가상 샘플 브랜드 — 실제 브랜드·법인 관계 아님. 실제 정보로 교체하기 전에는 게시하지 마세요.',
      },
    });
    brandIds.set(b.slug, created.id);
    counts.brands++;
  }

  for (const [i, p] of (snap.portfolio as Any[]).entries()) {
    if (await prisma.portfolioItem.findUnique({ where: { organizationId_slug: { organizationId: org.id, slug: p.slug } } })) continue;
    await prisma.portfolioItem.create({
      data: {
        organizationId: org.id, slug: p.slug, title: p.title, summary: p.summary, body: p.body ?? null, client: p.client, year: p.year, imageUrl: p.imageUrl,
        tags: p.tags ?? [], featured: !!p.featured, sortOrder: i, status: 'DRAFT', brandId: p.brand?.slug ? brandIds.get(p.brand.slug) ?? null : null,
      },
    });
    counts.portfolio++;
  }

  for (const p of snap.posts as Any[]) {
    if (await prisma.websitePost.findUnique({ where: { organizationId_type_slug: { organizationId: org.id, type: p.type, slug: p.slug } } })) continue;
    await prisma.websitePost.create({
      data: {
        organizationId: org.id, type: p.type, slug: p.slug, title: p.title, excerpt: p.excerpt, body: p.body ?? '', coverImageUrl: p.coverImageUrl,
        metadata: (p.metadata ?? {}) as Prisma.InputJsonValue, status: 'DRAFT', publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
      },
    });
    counts.posts++;
  }

  console.log('[import] 완료', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
