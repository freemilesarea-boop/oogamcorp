import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BrandsService } from './brands.service';
import { BusinessAreasService } from './business-areas.service';
import type { RevisionEntity } from './dto/cms.dto';
import { PagesService } from './pages.service';
import { PortfolioService } from './portfolio.service';
import { PostsService } from './posts.service';

type Snap = Record<string, unknown>;

/** 복구 시 되돌리는 필드 (상태·슬러그·작성자 등 메타 정보는 복구하지 않는다) */
const RESTORE_FIELDS: Record<Exclude<RevisionEntity, 'page'>, string[]> = {
  brand: ['name', 'tagline', 'description', 'logoUrl', 'imageUrl', 'websiteUrl', 'category', 'relationshipNote', 'seoTitle', 'seoDescription'],
  portfolio: ['title', 'summary', 'body', 'client', 'year', 'imageUrl', 'brandId', 'tags', 'featured'],
  post: ['title', 'excerpt', 'body', 'coverImageUrl', 'metadata', 'seoTitle', 'seoDescription'],
  business_area: ['title', 'subtitle', 'summary', 'body', 'imageUrl', 'highlights', 'ctaLabel', 'ctaHref', 'seoTitle', 'seoDescription'],
};

function pick(src: Snap, keys: string[]): Snap {
  const out: Snap = {};
  for (const k of keys) if (k in src) out[k] = src[k];
  return out;
}

/**
 * CMS 변경 이력. 저장·게시·상태 변경 결과를 스냅샷으로 남기고, 이전 버전을 "초안"으로 복구한다.
 * 복구는 공개본을 바로 바꾸지 않는다 — 게시 권한자가 다시 게시해야 공개 사이트에 반영된다(페이지).
 * 브랜드·포트폴리오·게시물·사업 영역은 각 서비스의 수정 규칙(게시 중 항목은 cms.publish 필요)을 그대로 따른다.
 */
@Injectable()
export class RevisionsService {
  private readonly logger = new Logger(RevisionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pages: PagesService,
    private readonly brands: BrandsService,
    private readonly portfolio: PortfolioService,
    private readonly posts: PostsService,
    private readonly areas: BusinessAreasService,
  ) {}

  /** 이력 기록 실패가 본 작업을 깨뜨리지 않도록 로그만 남긴다 */
  async record(auth: AuthContext, entityType: RevisionEntity, entityId: string, action: string, snapshot: unknown): Promise<void> {
    try {
      await this.prisma.cmsRevision.create({
        data: {
          organizationId: auth.organizationId, entityType, entityId, action, actorId: auth.userId,
          snapshot: JSON.parse(JSON.stringify(snapshot ?? {})) as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.logger.error(`변경 이력 기록 실패 (${entityType}/${entityId}): ${(e as Error).message}`);
    }
  }

  async list(auth: AuthContext, entityType: RevisionEntity, entityId: string) {
    const rows = await this.prisma.cmsRevision.findMany({
      where: { organizationId: auth.organizationId, entityType, entityId },
      select: { id: true, action: true, actorId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const users = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ id: r.id, action: r.action, createdAt: r.createdAt, actor: r.actorId ? { id: r.actorId, name: names.get(r.actorId) ?? '알 수 없음' } : null }));
  }

  async get(auth: AuthContext, id: string) {
    const rev = await this.prisma.cmsRevision.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!rev) throw new NotFoundException('변경 이력을 찾을 수 없습니다.');
    return rev;
  }

  /** 이전 버전을 현재 초안으로 복구 (권한은 각 편집 규칙을 따름) */
  async restore(auth: AuthContext, id: string) {
    const rev = await this.get(auth, id);
    const snap = (rev.snapshot ?? {}) as Snap;
    const type = rev.entityType as RevisionEntity;
    let result: unknown;
    switch (type) {
      case 'page': {
        result = await this.pages.save(auth, rev.entityId, {
          content: (snap.content ?? {}) as Record<string, unknown>,
          ...(typeof snap.title === 'string' ? { title: snap.title } : {}),
          seoTitle: (snap.seoTitle as string | null) ?? null,
          seoDescription: (snap.seoDescription as string | null) ?? null,
          ogImageUrl: (snap.ogImageUrl as string | null) ?? null,
        });
        break;
      }
      case 'brand':
        result = await this.brands.update(auth, rev.entityId, pick(snap, RESTORE_FIELDS.brand));
        break;
      case 'portfolio': {
        const data = pick(snap, RESTORE_FIELDS.portfolio);
        // 연결 브랜드가 삭제되었으면 연결을 해제한다
        if (typeof data.brandId === 'string') {
          const exists = await this.prisma.brand.count({ where: { id: data.brandId, organizationId: auth.organizationId, deletedAt: null } });
          if (!exists) data.brandId = null;
        }
        result = await this.portfolio.update(auth, rev.entityId, data);
        break;
      }
      case 'post':
        result = await this.posts.update(auth, rev.entityId, pick(snap, RESTORE_FIELDS.post));
        break;
      case 'business_area':
        result = await this.areas.update(auth, rev.entityId, pick(snap, RESTORE_FIELDS.business_area));
        break;
      default:
        throw new NotFoundException('복구할 수 없는 이력입니다.');
    }
    await this.record(auth, type, rev.entityId, 'restored', result);
    await this.audit.forUser(auth, 'cms.revision.restored', { entityType: type, entityId: rev.entityId, metadata: { revisionId: rev.id } });
    return result;
  }
}
