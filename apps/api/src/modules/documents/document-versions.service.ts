import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityType, Prisma } from '@prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { pageArgs, paginated, PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { extractText, sanitizeDoc } from '../../common/utils/tiptap';
import { DocumentAccessService } from './document-access.service';
import { userSummary } from './documents.service';
import { replaceYContent } from './ydoc';

/**
 * 문서 버전(스냅샷) 관리.
 * 스냅샷은 (pageId, version) 단위로 유일하다. 같은 버전의 내용은 항상 동일하므로
 * 이미 해당 버전 스냅샷이 있으면 새로 만들지 않고 재사용(수동 저장 시 사유만 MANUAL 로 승격)한다.
 */
@Injectable()
export class DocumentVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docAccess: DocumentAccessService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, pageId: string, q: PaginationQueryDto) {
    await this.docAccess.require(auth, pageId, 'view');
    const { skip, take, page, pageSize } = pageArgs(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.pageSnapshot.findMany({
        where: { pageId },
        orderBy: { version: 'desc' },
        skip,
        take,
        select: { id: true, version: true, title: true, reason: true, createdAt: true, createdById: true },
      }),
      this.prisma.pageSnapshot.count({ where: { pageId } }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.createdById).filter(Boolean) as string[] } }, ...userSummary });
    const u = new Map(users.map((x) => [x.id, x]));
    return paginated(rows.map((r) => ({ ...r, createdBy: r.createdById ? u.get(r.createdById) ?? null : null })), total, page, pageSize);
  }

  async get(auth: AuthContext, pageId: string, snapshotId: string) {
    await this.docAccess.require(auth, pageId, 'view');
    const snap = await this.prisma.pageSnapshot.findFirst({
      where: { id: snapshotId, pageId },
      select: { id: true, version: true, title: true, content: true, reason: true, createdAt: true, createdById: true },
    });
    if (!snap) throw new NotFoundException('버전을 찾을 수 없습니다.');
    return snap;
  }

  /** 현재 상태를 수동 스냅샷으로 저장 */
  async create(auth: AuthContext, pageId: string) {
    const { page } = await this.docAccess.require(auth, pageId, 'edit');
    const snap = await this.prisma.pageSnapshot.upsert({
      where: { pageId_version: { pageId, version: page.version } },
      create: { pageId, version: page.version, title: page.title, content: (page.content ?? undefined) as Prisma.InputJsonValue | undefined, reason: 'MANUAL', createdById: auth.userId },
      update: { reason: 'MANUAL', title: page.title, createdById: auth.userId },
      select: { id: true, version: true, title: true, reason: true, createdAt: true },
    });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PAGE, entityId: pageId, action: 'page.snapshot', actorId: auth.userId, changes: { version: page.version } });
    return snap;
  }

  /**
   * 스냅샷 복원: 현재 상태를 RESTORE 스냅샷으로 먼저 보존한 뒤(트랜잭션) 내용을 되돌리고 version+1.
   * 실시간 편집 상태(yState)가 있으면 CRDT 호환 방식으로 교체 → 협업 서버가 변경을 감지해 접속자에게 전파한다.
   */
  async restore(auth: AuthContext, pageId: string, snapshotId: string, meta: { ip?: string; userAgent?: string }) {
    await this.docAccess.require(auth, pageId, 'edit');
    const result = await this.prisma.$transaction(async (tx) => {
      // 동시 저장과 경합하지 않도록 행 잠금
      await tx.$queryRaw`SELECT id FROM pages WHERE id = ${pageId}::uuid FOR UPDATE`;
      const page = await tx.page.findUniqueOrThrow({ where: { id: pageId } });
      const snap = await tx.pageSnapshot.findFirst({ where: { id: snapshotId, pageId } });
      if (!snap) throw new NotFoundException('버전을 찾을 수 없습니다.');
      await tx.pageSnapshot.createMany({
        data: [{ pageId, version: page.version, title: page.title, content: (page.content ?? undefined) as Prisma.InputJsonValue | undefined, yState: page.yState ?? undefined, reason: 'RESTORE', createdById: auth.userId }],
        skipDuplicates: true,
      });
      const content = sanitizeDoc(snap.content ?? { type: 'doc', content: [] }) as Prisma.InputJsonValue;
      const version = page.version + 1;
      await tx.page.update({
        where: { id: pageId },
        data: {
          title: snap.title,
          content,
          contentText: extractText(content),
          version,
          updatedById: auth.userId,
          ...(page.yState ? { yState: replaceYContent(page.yState, content) } : {}),
        },
      });
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PAGE, entityId: pageId, action: 'page.version_restored', actorId: auth.userId, changes: { fromVersion: snap.version, newVersion: version } }, tx);
      return { version, restoredFrom: snap.version };
    });
    await this.audit.forUser(auth, 'page.version_restored', { entityType: 'page', entityId: pageId, metadata: result, ...meta });
    return result;
  }
}
