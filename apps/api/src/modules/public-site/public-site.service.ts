import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { NotificationType, PostType, Prisma, ResourceType } from '@prisma/client';
import { NotifyService } from '../../common/notify/notify.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hashIp } from '../../common/utils/request';
import { loadConfig } from '../../config/configuration';
import { CreateInquiryDto, PublicPortfolioQueryDto, PublicPostsQueryDto } from './public-site.dto';

/** 공개 응답에서 내부 필드(관계 메모, 작성자, 조직 ID 등)는 제외한다 */
const brandPublic = {
  id: true, slug: true, name: true, tagline: true, description: true, logoUrl: true, imageUrl: true, websiteUrl: true,
  category: true, sortOrder: true, publishedAt: true, updatedAt: true, seoTitle: true, seoDescription: true,
} satisfies Prisma.BrandSelect;
const brandRefPublic = { id: true, slug: true, name: true } satisfies Prisma.BrandSelect;
const portfolioPublic = {
  id: true, slug: true, title: true, summary: true, body: true, client: true, year: true, imageUrl: true, tags: true, featured: true,
  sortOrder: true, publishedAt: true, updatedAt: true, brandId: true,
} satisfies Prisma.PortfolioItemSelect;
const areaPublic = {
  id: true, slug: true, title: true, subtitle: true, summary: true, imageUrl: true, highlights: true, ctaLabel: true, ctaHref: true,
  seoTitle: true, seoDescription: true, sortOrder: true, publishedAt: true, updatedAt: true,
} satisfies Prisma.BusinessAreaSelect;
const postListPublic = {
  id: true, type: true, slug: true, title: true, excerpt: true, coverImageUrl: true, metadata: true, publishedAt: true, updatedAt: true,
} satisfies Prisma.WebsitePostSelect;

/** 공개 조회 옵션. preview=true 는 서버에서 cms.read 세션을 확인한 경우에만 사용한다 (초안 포함) */
export interface ReadOpts {
  preview?: boolean;
}

type NavItem = { href: string; label: string };
const NAV_LINK_RE = /^(\/(?!\/)|https?:\/\/|mailto:)/i;

const NAV = [
  { href: '/about', label: 'About' },
  { href: '/business', label: 'Business' },
  { href: '/brands', label: 'Brands' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/news', label: 'News' },
  { href: '/careers', label: 'Careers' },
  { href: '/contact', label: 'Contact' },
];

@Injectable()
export class PublicSiteService {
  private readonly logger = new Logger(PublicSiteService.name);
  private orgCache: { id: string; name: string; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

  /** 공개 사이트 조직: SITE_ORG_SLUG (기본 'oogam') */
  async org(): Promise<{ id: string; name: string }> {
    if (this.orgCache && Date.now() - this.orgCache.at < 60_000) return this.orgCache;
    const slug = process.env.SITE_ORG_SLUG || 'oogam';
    const org = await this.prisma.organization.findUnique({ where: { slug }, select: { id: true, name: true } });
    if (!org) throw new ServiceUnavailableException('사이트 조직이 설정되지 않았습니다.');
    this.orgCache = { ...org, at: Date.now() };
    return org;
  }

  /** 게시됨 + 게시일 도래 + 미삭제 */
  private live(orgId: string, opts?: ReadOpts) {
    // 미리보기: 보관(ARCHIVED)·삭제 항목을 제외한 초안·검토·게시 항목 모두
    if (opts?.preview) return { organizationId: orgId, deletedAt: null, status: { not: 'ARCHIVED' as const } };
    return { organizationId: orgId, status: 'PUBLISHED' as const, deletedAt: null, publishedAt: { lte: new Date() } };
  }

  private async publishedPage(orgId: string, key: string, opts?: ReadOpts) {
    if (opts?.preview) {
      const draft = await this.prisma.websitePage.findFirst({
        where: { organizationId: orgId, key },
        select: { key: true, title: true, content: true, seoTitle: true, seoDescription: true, ogImageUrl: true, publishedAt: true, updatedAt: true },
      });
      if (!draft) return null;
      return {
        key: draft.key, title: draft.title, content: draft.content,
        seo: { title: draft.seoTitle, description: draft.seoDescription, ogImageUrl: draft.ogImageUrl },
        publishedAt: draft.publishedAt, updatedAt: draft.updatedAt,
      };
    }
    const page = await this.prisma.websitePage.findFirst({
      where: { organizationId: orgId, key, status: 'PUBLISHED', publishedContent: { not: Prisma.AnyNull } },
      select: { key: true, title: true, publishedContent: true, seoTitle: true, seoDescription: true, ogImageUrl: true, publishedAt: true, updatedAt: true },
    });
    if (!page) return null;
    return {
      key: page.key, title: page.title, content: page.publishedContent,
      seo: { title: page.seoTitle, description: page.seoDescription, ogImageUrl: page.ogImageUrl },
      publishedAt: page.publishedAt, updatedAt: page.updatedAt,
    };
  }

  async site(opts?: ReadOpts) {
    const org = await this.org();
    const [settings, home] = await Promise.all([this.publishedPage(org.id, 'site', opts), this.publishedPage(org.id, 'home', opts)]);
    const footer = (settings?.content ?? null) as Record<string, unknown> | null;
    const siteSeo = settings?.seo;
    const homeSeo = home?.seo ?? { title: null, description: null, ogImageUrl: null };
    return {
      name: org.name,
      nav: this.nav(footer?.nav),
      cta: footer && typeof footer.headerCtaLabel === 'string' && typeof footer.headerCtaHref === 'string' && NAV_LINK_RE.test(footer.headerCtaHref)
        ? { label: footer.headerCtaLabel, href: footer.headerCtaHref }
        : null,
      footer,
      // 사이트 기본 SEO(site 페이지) → 없으면 홈 SEO
      seo: {
        title: siteSeo?.title || homeSeo.title,
        description: siteSeo?.description || homeSeo.description,
        ogImageUrl: siteSeo?.ogImageUrl || homeSeo.ogImageUrl,
      },
    };
  }

  /** CMS 메뉴(site.nav) — 숨김 제외, 링크 형식 재검증. 비어 있으면 기본 메뉴 */
  private nav(raw: unknown): NavItem[] {
    if (!Array.isArray(raw)) return NAV;
    const items = raw
      .filter((x): x is { label?: unknown; href?: unknown; visible?: unknown } => !!x && typeof x === 'object')
      .filter((x) => x.visible !== false && typeof x.label === 'string' && x.label.trim() && typeof x.href === 'string' && NAV_LINK_RE.test(x.href))
      .map((x) => ({ label: (x.label as string).trim(), href: x.href as string }));
    return items.length ? items : NAV;
  }

  async page(key: string, opts?: ReadOpts) {
    const org = await this.org();
    const page = await this.publishedPage(org.id, key, opts);
    if (!page) throw new NotFoundException('페이지를 찾을 수 없습니다.');
    return page;
  }

  async home(opts?: ReadOpts) {
    const org = await this.org();
    const [page, businessAreas, brands, featured, news, publishedIds] = await Promise.all([
      this.publishedPage(org.id, 'home', opts),
      this.prisma.businessArea.findMany({ where: this.live(org.id, opts), select: areaPublic, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 12 }),
      this.prisma.brand.findMany({ where: this.live(org.id, opts), select: brandPublic, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 12 }),
      this.prisma.portfolioItem.findMany({
        where: { ...this.live(org.id, opts), featured: true },
        select: { ...portfolioPublic, body: false, brand: { select: brandRefPublic } },
        orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }],
        take: 6,
      }),
      this.prisma.websitePost.findMany({
        where: { ...this.live(org.id, opts), type: { in: ['NEWS', 'INSIGHT'] } }, select: postListPublic, orderBy: { publishedAt: 'desc' }, take: 3,
      }),
      this.publishedBrandIds(org.id, opts),
    ]);
    return { page, businessAreas, brands, featured: featured.map((p) => this.maskBrand(p, publishedIds)), news };
  }

  /** 연결된 브랜드가 비공개면 브랜드 정보를 숨긴다 */
  private maskBrand<T extends { brand?: { id: string } | null }>(item: T, publishedBrandIds: Set<string>) {
    return { ...item, brand: item.brand && publishedBrandIds.has(item.brand.id) ? item.brand : null };
  }

  private async publishedBrandIds(orgId: string, opts?: ReadOpts) {
    const rows = await this.prisma.brand.findMany({ where: this.live(orgId, opts), select: { id: true } });
    return new Set(rows.map((r) => r.id));
  }

  async businessAreas(opts?: ReadOpts) {
    const org = await this.org();
    return this.prisma.businessArea.findMany({ where: this.live(org.id, opts), select: areaPublic, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async businessArea(slug: string, opts?: ReadOpts) {
    const org = await this.org();
    const area = await this.prisma.businessArea.findFirst({ where: { ...this.live(org.id, opts), slug }, select: { ...areaPublic, body: true } });
    if (!area) throw new NotFoundException('사업 영역을 찾을 수 없습니다.');
    return area;
  }

  async brands(opts?: ReadOpts) {
    const org = await this.org();
    return this.prisma.brand.findMany({ where: this.live(org.id, opts), select: brandPublic, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async brand(slug: string, opts?: ReadOpts) {
    const org = await this.org();
    const brand = await this.prisma.brand.findFirst({ where: { ...this.live(org.id, opts), slug }, select: brandPublic });
    if (!brand) throw new NotFoundException('브랜드를 찾을 수 없습니다.');
    const portfolio = await this.prisma.portfolioItem.findMany({
      where: { ...this.live(org.id, opts), brandId: brand.id },
      select: { ...portfolioPublic, body: false },
      orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }],
    });
    return { ...brand, portfolio };
  }

  async portfolio(q: PublicPortfolioQueryDto, opts?: ReadOpts) {
    const org = await this.org();
    const where: Prisma.PortfolioItemWhereInput = { ...this.live(org.id, opts), ...(q.featured ? { featured: q.featured === 'true' } : {}) };
    if (q.brand) where.brand = { ...this.live(org.id, opts), slug: q.brand };
    const [items, publishedIds] = await Promise.all([
      this.prisma.portfolioItem.findMany({
        where, select: { ...portfolioPublic, brand: { select: brandRefPublic } }, orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }], take: 200,
      }),
      this.publishedBrandIds(org.id, opts),
    ]);
    return items.map((i) => this.maskBrand(i, publishedIds));
  }

  async posts(q: PublicPostsQueryDto, opts?: ReadOpts) {
    const org = await this.org();
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 12;
    const where: Prisma.WebsitePostWhereInput = { ...this.live(org.id, opts), type: q.type ? q.type : { in: ['NEWS', 'INSIGHT'] } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.websitePost.findMany({ where, select: postListPublic, orderBy: { publishedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.websitePost.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /** 본문(body)은 저장된 텍스트 그대로 반환 — 서버에서 HTML 로 렌더링하지 않는다 */
  async post(type: PostType, slug: string, opts?: ReadOpts) {
    const org = await this.org();
    const post = await this.prisma.websitePost.findFirst({
      where: { ...this.live(org.id, opts), type, slug },
      select: { ...postListPublic, body: true, seoTitle: true, seoDescription: true },
    });
    if (!post) throw new NotFoundException('게시물을 찾을 수 없습니다.');
    return post;
  }

  async sitemap() {
    const org = await this.org();
    const [pages, brands, businessAreas, posts] = await Promise.all([
      this.prisma.websitePage.findMany({ where: { organizationId: org.id, status: 'PUBLISHED', key: { not: 'site' } }, select: { key: true, updatedAt: true } }),
      this.prisma.brand.findMany({ where: this.live(org.id), select: { slug: true, updatedAt: true } }),
      this.prisma.businessArea.findMany({ where: this.live(org.id), select: { slug: true, updatedAt: true } }),
      this.prisma.websitePost.findMany({ where: this.live(org.id), select: { type: true, slug: true, updatedAt: true }, take: 5000 }),
    ]);
    return { pages, brands, businessAreas, posts };
  }

  /** 공개 문의 접수. 원본 IP 는 저장하지 않고 솔트 해시만 저장 */
  async createInquiry(dto: CreateInquiryDto, meta: { ip: string; userAgent?: string }): Promise<{ ok: true }> {
    // 허니팟이 채워졌으면 봇으로 간주: 성공처럼 응답하고 저장하지 않음
    if (dto.website && dto.website.trim() !== '') {
      this.logger.warn('허니팟 필드가 채워진 문의를 폐기했습니다.');
      return { ok: true };
    }
    const org = await this.org();
    const inquiry = await this.prisma.contactInquiry.create({
      data: {
        organizationId: org.id,
        name: dto.name,
        email: dto.email.toLowerCase(),
        phone: dto.phone || null,
        company: dto.company || null,
        category: dto.category ?? 'GENERAL',
        message: dto.message,
        consentAt: new Date(),
        ipHash: meta.ip ? hashIp(meta.ip, loadConfig().ipHashSalt) : null,
        userAgent: meta.userAgent?.slice(0, 255),
      },
      select: { id: true, category: true },
    });
    try {
      const recipients = await this.inquiryRecipients(org.id);
      await this.notify.send({
        organizationId: org.id,
        userIds: recipients,
        type: NotificationType.SYSTEM,
        // 알림에는 개인정보(이름·연락처·내용)를 담지 않는다
        title: '새 홈페이지 문의가 접수되었습니다.',
        body: `분류: ${inquiry.category}`,
        link: '/admin/cms/inquiries',
      });
    } catch (e) {
      this.logger.error(`문의 알림 발송 실패: ${(e as Error).message}`);
    }
    return { ok: true };
  }

  /** cms.inquiries 권한 보유자 (역할 권한 ∪ 모듈 단위 명시 부여), 활성 사용자만 */
  private async inquiryRecipients(orgId: string): Promise<string[]> {
    const now = new Date();
    const [byRole, grants] = await Promise.all([
      this.prisma.membership.findMany({
        where: {
          organizationId: orgId, employmentStatus: 'ACTIVE', user: { status: 'ACTIVE' },
          role: { permissions: { some: { permission: { key: 'cms.inquiries' } } } },
        },
        select: { userId: true },
      }),
      this.prisma.resourceGrant.findMany({
        where: {
          organizationId: orgId, resourceType: ResourceType.MODULE, resourceId: 'cms.inquiries',
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { userId: true, departmentId: true },
      }),
    ]);
    const deptIds = grants.map((g) => g.departmentId).filter((d): d is string => !!d);
    const byDept = deptIds.length
      ? await this.prisma.membership.findMany({
          where: { organizationId: orgId, departmentId: { in: deptIds }, employmentStatus: 'ACTIVE', user: { status: 'ACTIVE' } },
          select: { userId: true },
        })
      : [];
    const direct = grants.map((g) => g.userId).filter((u): u is string => !!u);
    return [...new Set([...byRole.map((m) => m.userId), ...byDept.map((m) => m.userId), ...direct])];
  }
}
