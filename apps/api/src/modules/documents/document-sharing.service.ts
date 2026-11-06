import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityType } from '@prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { NotifyService } from '../../common/notify/notify.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DocumentAccessService } from './document-access.service';
import { GrantDto, VisibilityDto } from './dto/document.dto';

type Meta = { ip?: string; userAgent?: string };

/** 문서 공유/권한 관리 (resource_grants PAGE + 공개 범위). FULL 접근 필요, 변경은 감사 로그에 기록 */
@Injectable()
export class DocumentSharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docAccess: DocumentAccessService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  async list(auth: AuthContext, pageId: string) {
    const { page, level } = await this.docAccess.require(auth, pageId, 'full');
    const grants = await this.prisma.resourceGrant.findMany({
      where: { organizationId: auth.organizationId, resourceType: 'PAGE', resourceId: pageId },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const owner = await this.prisma.user.findUnique({ where: { id: page.createdById }, select: { id: true, name: true, email: true, avatarUrl: true } });
    return {
      visibility: page.visibility,
      access: level,
      owner,
      grants: grants.map((g) => ({ id: g.id, access: g.access, expiresAt: g.expiresAt, createdAt: g.createdAt, user: g.user, department: g.department })),
    };
  }

  async add(auth: AuthContext, pageId: string, dto: GrantDto, meta: Meta) {
    const { page } = await this.docAccess.require(auth, pageId, 'full');
    if (!dto.userId && !dto.departmentId) throw new BadRequestException('사용자 또는 부서를 지정하세요.');
    if (dto.userId && dto.departmentId) throw new BadRequestException('사용자와 부서 중 하나만 지정하세요.');
    await this.docAccess.assertOrgPrincipal(auth, dto);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw new BadRequestException('만료일은 현재 이후여야 합니다.');
    const existing = await this.prisma.resourceGrant.findFirst({
      where: { organizationId: auth.organizationId, resourceType: 'PAGE', resourceId: pageId, ...(dto.userId ? { userId: dto.userId } : { departmentId: dto.departmentId }) },
    });
    const grant = existing
      ? await this.prisma.resourceGrant.update({ where: { id: existing.id }, data: { access: dto.access, expiresAt, grantedById: auth.userId } })
      : await this.prisma.resourceGrant.create({
          data: {
            organizationId: auth.organizationId,
            resourceType: 'PAGE',
            resourceId: pageId,
            userId: dto.userId ?? null,
            departmentId: dto.departmentId ?? null,
            access: dto.access,
            expiresAt,
            grantedById: auth.userId,
          },
        });
    await this.audit.forUser(auth, 'page.grant.set', { entityType: 'page', entityId: pageId, metadata: { userId: dto.userId, departmentId: dto.departmentId, access: dto.access, previous: existing?.access ?? null }, ...meta });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PAGE, entityId: pageId, action: 'page.shared', actorId: auth.userId, changes: { userId: dto.userId, departmentId: dto.departmentId, access: dto.access } });
    if (dto.userId && !existing) {
      await this.notify.send({
        organizationId: auth.organizationId,
        userIds: [dto.userId],
        actorId: auth.userId,
        type: 'SYSTEM',
        title: `${auth.name}님이 문서를 공유했습니다: ${page.title || '제목 없음'}`,
        link: `/admin/docs/${pageId}`,
        entityType: 'PAGE',
        entityId: pageId,
      });
    }
    return grant;
  }

  async remove(auth: AuthContext, pageId: string, grantId: string, meta: Meta) {
    await this.docAccess.require(auth, pageId, 'full');
    const grant = await this.prisma.resourceGrant.findFirst({ where: { id: grantId, organizationId: auth.organizationId, resourceType: 'PAGE', resourceId: pageId } });
    if (!grant) throw new NotFoundException('권한 항목을 찾을 수 없습니다.');
    await this.prisma.resourceGrant.delete({ where: { id: grantId } });
    await this.audit.forUser(auth, 'page.grant.removed', { entityType: 'page', entityId: pageId, metadata: { userId: grant.userId, departmentId: grant.departmentId, access: grant.access }, ...meta });
    return { ok: true };
  }

  async setVisibility(auth: AuthContext, pageId: string, dto: VisibilityDto, meta: Meta) {
    const { page } = await this.docAccess.require(auth, pageId, 'full');
    if (page.visibility === dto.visibility) return { visibility: page.visibility };
    await this.prisma.page.update({ where: { id: pageId }, data: { visibility: dto.visibility } });
    await this.audit.forUser(auth, 'page.visibility.changed', { entityType: 'page', entityId: pageId, metadata: { from: page.visibility, to: dto.visibility }, ...meta });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PAGE, entityId: pageId, action: 'page.visibility_changed', actorId: auth.userId, changes: { visibility: { from: page.visibility, to: dto.visibility } } });
    return { visibility: dto.visibility };
  }
}
