import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Announcement, Prisma } from '@prisma/client';
import { ROLE_RANK } from '@oogam/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { pageArgs, paginated } from '../../common/dto/pagination.dto';
import { NotifyService } from '../../common/notify/notify.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntityAccessService } from '../access/entity-access.service';
import { visibleProjectIds } from '../employees/project-visibility';
import { AnnouncementQueryDto, CreateAnnouncementDto, UpdateAnnouncementDto } from './announcements.dto';

/**
 * 공지사항. 대상 범위(scope)별 열람 규칙
 * - COMPANY: 조직 전체
 * - DEPARTMENT: 해당 부서 소속만
 * - PROJECT: 해당 프로젝트를 열람할 수 있는 사용자만
 * 작성자는 언제나 자신의 공지를 볼 수 있다.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entityAccess: EntityAccessService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  async visibleWhere(auth: AuthContext): Promise<Prisma.AnnouncementWhereInput> {
    const projectIds = await visibleProjectIds(this.prisma, auth);
    return {
      organizationId: auth.organizationId,
      deletedAt: null,
      publishedAt: { lte: new Date() },
      OR: [
        { scope: 'COMPANY' },
        ...(auth.departmentId ? [{ scope: 'DEPARTMENT' as const, departmentId: auth.departmentId }] : []),
        ...(projectIds.length ? [{ scope: 'PROJECT' as const, projectId: { in: projectIds } }] : []),
        { authorId: auth.userId },
      ],
    };
  }

  private async decorate(auth: AuthContext, rows: (Announcement & { reads: { readAt: Date }[]; _count?: { reads: number } })[]) {
    const authorIds = [...new Set(rows.map((r) => r.authorId))];
    const deptIds = [...new Set(rows.map((r) => r.departmentId).filter(Boolean))] as string[];
    const projIds = [...new Set(rows.map((r) => r.projectId).filter(Boolean))] as string[];
    const [authors, depts, projs] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, avatarUrl: true } }),
      deptIds.length ? this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : [],
      projIds.length ? this.prisma.project.findMany({ where: { id: { in: projIds } }, select: { id: true, key: true, name: true } }) : [],
    ]);
    const a = new Map(authors.map((x) => [x.id, x]));
    const d = new Map(depts.map((x) => [x.id, x]));
    const p = new Map(projs.map((x) => [x.id, x]));
    return rows.map(({ reads, _count, ...r }) => ({
      ...r,
      author: a.get(r.authorId) ?? null,
      department: r.departmentId ? d.get(r.departmentId) ?? null : null,
      project: r.projectId ? p.get(r.projectId) ?? null : null,
      read: reads.length > 0,
      readAt: reads[0]?.readAt ?? null,
      canEdit: this.canEdit(auth, r),
      // 열람 현황은 작성자/편집 권한자에게만
      readCount: this.canEdit(auth, r) ? _count?.reads ?? 0 : undefined,
    }));
  }

  private canEdit(auth: AuthContext, a: Pick<Announcement, 'authorId'>) {
    if (!auth.permissions.has('announcements.write')) return false;
    return a.authorId === auth.userId || auth.roleRank >= ROLE_RANK.EXECUTIVE;
  }

  async list(auth: AuthContext, q: AnnouncementQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.AnnouncementWhereInput = {
      AND: [
        await this.visibleWhere(auth),
        q.scope ? { scope: q.scope } : {},
        q.unread === 'true' ? { reads: { none: { userId: auth.userId } } } : {},
        q.mine === 'true' ? { authorId: auth.userId } : {},
        q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { body: { contains: q.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const [rows, total, unread] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
        skip,
        take,
        include: { reads: { where: { userId: auth.userId }, select: { readAt: true } }, _count: { select: { reads: true } } },
      }),
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.count({ where: { AND: [where, { reads: { none: { userId: auth.userId } } }] } }),
    ]);
    return { ...paginated(await this.decorate(auth, rows), total, page, pageSize), unreadCount: unread };
  }

  private async requireVisible(auth: AuthContext, id: string) {
    const row = await this.prisma.announcement.findFirst({
      where: { AND: [{ id }, await this.visibleWhere(auth)] },
      include: { reads: { where: { userId: auth.userId }, select: { readAt: true } }, _count: { select: { reads: true } } },
    });
    if (!row) throw new NotFoundException('공지를 찾을 수 없습니다.');
    return row;
  }

  async get(auth: AuthContext, id: string) {
    const [row] = await this.decorate(auth, [await this.requireVisible(auth, id)]);
    return row;
  }

  /** 공지 대상자 (알림 수신자) */
  private async audience(auth: AuthContext, a: Pick<Announcement, 'scope' | 'departmentId' | 'projectId'>): Promise<string[]> {
    const active = { organizationId: auth.organizationId, employmentStatus: { not: 'RESIGNED' as const }, user: { status: 'ACTIVE' as const, deletedAt: null } };
    if (a.scope === 'COMPANY') {
      return (await this.prisma.membership.findMany({ where: active, select: { userId: true } })).map((m) => m.userId);
    }
    if (a.scope === 'DEPARTMENT' && a.departmentId) {
      return (await this.prisma.membership.findMany({ where: { ...active, departmentId: a.departmentId }, select: { userId: true } })).map((m) => m.userId);
    }
    if (a.scope === 'PROJECT' && a.projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: a.projectId }, select: { managerId: true, members: { select: { userId: true } } } });
      const ids = [...(project?.members.map((m) => m.userId) ?? []), ...(project?.managerId ? [project.managerId] : [])];
      const activeIds = await this.prisma.membership.findMany({ where: { ...active, userId: { in: ids } }, select: { userId: true } });
      return activeIds.map((m) => m.userId);
    }
    return [];
  }

  async create(auth: AuthContext, dto: CreateAnnouncementDto) {
    let departmentId: string | null = null;
    let projectId: string | null = null;
    if (dto.scope === 'DEPARTMENT') {
      const ok = await this.prisma.department.count({ where: { id: dto.departmentId, organizationId: auth.organizationId, deletedAt: null } });
      if (!ok) throw new BadRequestException('부서를 찾을 수 없습니다.');
      departmentId = dto.departmentId!;
    } else if (dto.scope === 'PROJECT') {
      // 프로젝트 공지는 해당 프로젝트 편집 권한(구성원 이상)이 있어야 작성 가능
      if (!(await this.entityAccess.can(auth, 'PROJECT', dto.projectId!, 'edit'))) {
        throw new ForbiddenException('해당 프로젝트에 공지를 작성할 권한이 없습니다.');
      }
      projectId = dto.projectId!;
    }
    const a = await this.prisma.announcement.create({
      data: {
        organizationId: auth.organizationId,
        scope: dto.scope,
        departmentId,
        projectId,
        title: dto.title,
        body: dto.body,
        pinned: dto.pinned ?? false,
        authorId: auth.userId,
      },
    });
    await this.prisma.announcementRead.create({ data: { announcementId: a.id, userId: auth.userId } });
    await this.notify.send({
      organizationId: auth.organizationId,
      userIds: await this.audience(auth, a),
      type: 'ANNOUNCEMENT',
      title: `[공지] ${a.title}`,
      body: a.body.slice(0, 200),
      link: `/admin/announcements?id=${a.id}`,
      entityType: 'ANNOUNCEMENT',
      entityId: a.id,
      actorId: auth.userId,
    });
    await this.audit.forUser(auth, 'announcement.created', { entityType: 'announcement', entityId: a.id, metadata: { scope: a.scope } });
    return this.get(auth, a.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateAnnouncementDto) {
    const row = await this.requireVisible(auth, id);
    if (!this.canEdit(auth, row)) throw new ForbiddenException('공지를 수정할 권한이 없습니다.');
    await this.prisma.announcement.update({ where: { id }, data: dto });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    const row = await this.requireVisible(auth, id);
    if (!this.canEdit(auth, row)) throw new ForbiddenException('공지를 삭제할 권한이 없습니다.');
    await this.prisma.announcement.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.forUser(auth, 'announcement.deleted', { entityType: 'announcement', entityId: id });
    return { ok: true };
  }

  async markRead(auth: AuthContext, id: string) {
    await this.requireVisible(auth, id);
    await this.prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId: id, userId: auth.userId } },
      create: { announcementId: id, userId: auth.userId },
      update: {},
    });
    return { ok: true };
  }

  /** 대시보드용 최신 공지 */
  async latest(auth: AuthContext, take = 5) {
    const rows = await this.prisma.announcement.findMany({
      where: await this.visibleWhere(auth),
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      take,
      include: { reads: { where: { userId: auth.userId }, select: { readAt: true } } },
    });
    return this.decorate(auth, rows);
  }
}
