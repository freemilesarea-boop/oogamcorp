import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type WebsitePage } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SavePageDto } from './dto/cms.dto';
import { PAGE_KEYS, PAGE_TITLES, validatePageContent } from './page-schemas';

/** 키 순서에 무관한 JSON 비교 (미게시 변경 여부 판단용) */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function hasUnpublishedChanges(p: Pick<WebsitePage, 'content' | 'publishedContent' | 'status'>): boolean {
  if (p.status !== 'PUBLISHED' || p.publishedContent === null) return true;
  return stable(p.content) !== stable(p.publishedContent);
}

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertKey(key: string) {
    if (!PAGE_KEYS.includes(key)) throw new NotFoundException('지원하지 않는 페이지입니다.');
  }

  /** 지원 키 전체를 반환 (아직 생성되지 않은 키도 exists=false 로 표시) */
  async list(auth: AuthContext) {
    const rows = await this.prisma.websitePage.findMany({ where: { organizationId: auth.organizationId } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return PAGE_KEYS.map((key) => {
      const p = byKey.get(key);
      return p
        ? {
            key, exists: true, id: p.id, title: p.title, status: p.status, publishedAt: p.publishedAt, updatedAt: p.updatedAt,
            hasUnpublishedChanges: hasUnpublishedChanges(p),
          }
        : { key, exists: false, id: null, title: PAGE_TITLES[key], status: 'DRAFT' as const, publishedAt: null, updatedAt: null, hasUnpublishedChanges: false };
    });
  }

  async get(auth: AuthContext, key: string) {
    this.assertKey(key);
    const page = await this.prisma.websitePage.findUnique({ where: { organizationId_key: { organizationId: auth.organizationId, key } } });
    if (!page) {
      return {
        key, exists: false, id: null, title: PAGE_TITLES[key], content: {}, publishedContent: null, status: 'DRAFT' as const,
        seoTitle: null, seoDescription: null, ogImageUrl: null, publishedAt: null, updatedAt: null, hasUnpublishedChanges: false,
      };
    }
    return { ...page, exists: true, hasUnpublishedChanges: hasUnpublishedChanges(page) };
  }

  /** 미리보기: 편집 중(draft) content 를 공개 응답과 동일한 형태로 반환 */
  async preview(auth: AuthContext, key: string) {
    const page = await this.get(auth, key);
    return {
      key, title: page.title, content: page.content, preview: true,
      seo: { title: page.seoTitle, description: page.seoDescription, ogImageUrl: page.ogImageUrl },
      updatedAt: page.updatedAt,
    };
  }

  async save(auth: AuthContext, key: string, dto: SavePageDto) {
    this.assertKey(key);
    validatePageContent(key, dto.content);
    const content = dto.content as Prisma.InputJsonValue;
    const page = await this.prisma.websitePage.upsert({
      where: { organizationId_key: { organizationId: auth.organizationId, key } },
      create: {
        organizationId: auth.organizationId, key, title: dto.title ?? PAGE_TITLES[key], content,
        seoTitle: dto.seoTitle, seoDescription: dto.seoDescription, ogImageUrl: dto.ogImageUrl, updatedById: auth.userId,
      },
      update: {
        content, updatedById: auth.userId,
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.seoTitle !== undefined ? { seoTitle: dto.seoTitle } : {}),
        ...(dto.seoDescription !== undefined ? { seoDescription: dto.seoDescription } : {}),
        ...(dto.ogImageUrl !== undefined ? { ogImageUrl: dto.ogImageUrl } : {}),
      },
    });
    await this.audit.forUser(auth, 'cms.page.draft_saved', { entityType: 'website_page', entityId: page.id, metadata: { key } });
    return { ...page, exists: true, hasUnpublishedChanges: hasUnpublishedChanges(page) };
  }

  /** 게시: content(초안) → publishedContent(공개본) 복사. cms.publish 필요 (컨트롤러) */
  async publish(auth: AuthContext, key: string) {
    this.assertKey(key);
    const page = await this.prisma.websitePage.findUnique({ where: { organizationId_key: { organizationId: auth.organizationId, key } } });
    if (!page) throw new NotFoundException('먼저 초안을 저장하세요.');
    validatePageContent(key, page.content as Record<string, unknown>);
    const updated = await this.prisma.websitePage.update({
      where: { id: page.id },
      data: {
        publishedContent: page.content as Prisma.InputJsonValue,
        status: 'PUBLISHED', publishedAt: new Date(), publishedById: auth.userId,
      },
    });
    await this.audit.forUser(auth, 'cms.page.published', { entityType: 'website_page', entityId: page.id, metadata: { key } });
    return { ...updated, exists: true, hasUnpublishedChanges: false };
  }

  async unpublish(auth: AuthContext, key: string) {
    this.assertKey(key);
    const page = await this.prisma.websitePage.findUnique({ where: { organizationId_key: { organizationId: auth.organizationId, key } } });
    if (!page) throw new NotFoundException('페이지를 찾을 수 없습니다.');
    if (page.status !== 'PUBLISHED') throw new BadRequestException('게시 중인 페이지가 아닙니다.');
    const updated = await this.prisma.websitePage.update({ where: { id: page.id }, data: { status: 'DRAFT' } });
    await this.audit.forUser(auth, 'cms.page.unpublished', { entityType: 'website_page', entityId: page.id, metadata: { key } });
    return { ...updated, exists: true, hasUnpublishedChanges: true };
  }

  /** 초안을 현재 공개본으로 되돌림 */
  async discardDraft(auth: AuthContext, key: string) {
    this.assertKey(key);
    const page = await this.prisma.websitePage.findUnique({ where: { organizationId_key: { organizationId: auth.organizationId, key } } });
    if (!page || page.publishedContent === null) throw new BadRequestException('되돌릴 공개본이 없습니다.');
    const updated = await this.prisma.websitePage.update({
      where: { id: page.id }, data: { content: page.publishedContent as Prisma.InputJsonValue, updatedById: auth.userId },
    });
    return { ...updated, exists: true, hasUnpublishedChanges: hasUnpublishedChanges(updated) };
  }
}
