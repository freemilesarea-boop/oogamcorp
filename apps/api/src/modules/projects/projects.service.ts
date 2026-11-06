import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityType, Prisma } from '@prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  AddMemberDto, CreateProjectDto, CustomStatusDto, LinkDto, MilestoneDto, ProjectQueryDto, UpdateMilestoneDto, UpdateProjectDto,
} from './dto/project.dto';
import { ProjectAccessService } from './project-access.service';
import { ProjectsRepository, userSummary } from './projects.repository';

const d = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProjectsRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, q: ProjectQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.ProjectWhereInput = {
      AND: [
        this.repo.visibleWhere(auth, await this.repo.grantedProjectIds(auth)),
        q.status ? { status: q.status } : {},
        q.priority ? { priority: q.priority } : {},
        q.departmentId ? { departmentId: q.departmentId } : {},
        q.managerId ? { managerId: q.managerId } : {},
        q.mine === 'true' ? { OR: [{ managerId: auth.userId }, { members: { some: { userId: auth.userId } } }] } : {},
        q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { key: { contains: q.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        skip,
        take,
        orderBy: orderByArg(q, ['createdAt', 'updatedAt', 'name', 'endDate', 'priority', 'progress'] as const, 'updatedAt'),
        include: {
          department: { select: { id: true, name: true } },
          _count: { select: { tasks: { where: { deletedAt: null } }, members: true } },
        },
      }),
      this.prisma.project.count({ where }),
    ]);
    const managerIds = [...new Set(items.map((p) => p.managerId).filter(Boolean))] as string[];
    const managers = await this.prisma.user.findMany({ where: { id: { in: managerIds } }, ...userSummary });
    const byId = new Map(managers.map((m) => [m.id, m]));
    return paginated(items.map((p) => ({ ...p, manager: p.managerId ? byId.get(p.managerId) ?? null : null })), total, page, pageSize);
  }

  private async assertOrgUsers(auth: AuthContext, userIds: (string | null | undefined)[]) {
    const ids = [...new Set(userIds.filter(Boolean))] as string[];
    if (!ids.length) return;
    const count = await this.prisma.membership.count({ where: { organizationId: auth.organizationId, userId: { in: ids } } });
    if (count !== ids.length) throw new BadRequestException('조직에 속하지 않은 사용자가 포함되어 있습니다.');
  }

  private async assertOrgRefs(auth: AuthContext, refs: { departmentId?: string | null; budgetId?: string | null }) {
    if (refs.departmentId) {
      const ok = await this.prisma.department.count({ where: { id: refs.departmentId, organizationId: auth.organizationId, deletedAt: null } });
      if (!ok) throw new BadRequestException('부서를 찾을 수 없습니다.');
    }
    if (refs.budgetId) {
      // 예산 연결은 재무 권한 보유자만 (민감 정보 연결 방지)
      if (!auth.permissions.has('finance.read')) throw new BadRequestException('예산 연결 권한이 없습니다.');
      const ok = await this.prisma.budget.count({ where: { id: refs.budgetId, organizationId: auth.organizationId, deletedAt: null } });
      if (!ok) throw new BadRequestException('예산을 찾을 수 없습니다.');
    }
  }

  async create(auth: AuthContext, dto: CreateProjectDto) {
    await this.assertOrgUsers(auth, [dto.managerId, ...(dto.memberIds ?? [])]);
    await this.assertOrgRefs(auth, dto);
    if (dto.startDate && dto.endDate && dto.startDate > dto.endDate) throw new BadRequestException('종료일은 시작일 이후여야 합니다.');
    return this.prisma.$transaction(async (tx) => {
      const key = dto.key ?? (await this.repo.nextKey(auth.organizationId, tx));
      const managerId = dto.managerId ?? auth.userId;
      const project = await tx.project.create({
        data: {
          organizationId: auth.organizationId,
          key,
          name: dto.name,
          description: dto.description,
          departmentId: dto.departmentId ?? auth.departmentId,
          managerId,
          status: dto.status,
          priority: dto.priority,
          startDate: d(dto.startDate),
          endDate: d(dto.endDate),
          budgetId: dto.budgetId,
          createdById: auth.userId,
        },
      });
      const memberIds = new Set([auth.userId, managerId, ...(dto.memberIds ?? [])]);
      await tx.projectMember.createMany({
        data: [...memberIds].map((userId) => ({ projectId: project.id, userId, role: userId === managerId ? 'MANAGER' : 'MEMBER' })),
        skipDuplicates: true,
      });
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PROJECT, entityId: project.id, action: 'project.created', actorId: auth.userId, changes: { name: dto.name } }, tx);
      await this.audit.forUser(auth, 'project.created', { entityType: 'project', entityId: project.id }, tx);
      return project;
    });
  }

  async get(auth: AuthContext, id: string) {
    const project = await this.projectAccess.require(auth, id, 'view');
    const level = await this.projectAccess.level(auth, project);
    const [members, milestones, statuses, department, counts, links] = await Promise.all([
      this.prisma.projectMember.findMany({ where: { projectId: id }, include: { user: userSummary }, orderBy: { createdAt: 'asc' } }),
      this.prisma.milestone.findMany({ where: { projectId: id }, orderBy: [{ position: 'asc' }, { dueDate: 'asc' }] }),
      this.prisma.projectTaskStatus.findMany({ where: { projectId: id }, orderBy: { position: 'asc' } }),
      project.departmentId ? this.prisma.department.findUnique({ where: { id: project.departmentId }, select: { id: true, name: true } }) : null,
      this.prisma.task.groupBy({ by: ['status'], where: { projectId: id, deletedAt: null, parentId: null }, _count: true }),
      this.prisma.entityLink.findMany({ where: { sourceType: 'PROJECT', sourceId: id } }),
    ]);
    const manager = project.managerId ? await this.prisma.user.findUnique({ where: { id: project.managerId }, ...userSummary }) : null;
    const pageIds = links.filter((l) => l.targetType === 'PAGE').map((l) => l.targetId);
    const pages = pageIds.length
      ? await this.prisma.page.findMany({ where: { id: { in: pageIds }, deletedAt: null }, select: { id: true, title: true, icon: true } })
      : [];
    const budget = project.budgetId && auth.permissions.has('finance.read')
      ? await this.prisma.budget.findUnique({ where: { id: project.budgetId }, select: { id: true, name: true, approvedAmount: true, fiscalYear: true } })
      : null;
    return {
      ...project,
      budgetId: auth.permissions.has('finance.read') ? project.budgetId : null,
      access: level,
      manager,
      department,
      members,
      milestones,
      statuses,
      taskCounts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      documents: pages,
      budget,
    };
  }

  async update(auth: AuthContext, id: string, dto: UpdateProjectDto) {
    const before = await this.projectAccess.require(auth, id, 'manage');
    await this.assertOrgUsers(auth, [dto.managerId]);
    await this.assertOrgRefs(auth, dto);
    const data: Prisma.ProjectUncheckedUpdateInput = {
      name: dto.name,
      description: dto.description,
      departmentId: dto.departmentId,
      managerId: dto.managerId,
      status: dto.status,
      priority: dto.priority,
      progress: dto.progress,
      startDate: d(dto.startDate),
      endDate: d(dto.endDate),
      budgetId: dto.budgetId,
    };
    const changes = ActivityService.diff(before as unknown as Record<string, unknown>, data as Record<string, unknown>);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.project.update({ where: { id }, data });
      if (dto.managerId) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: id, userId: dto.managerId } },
          create: { projectId: id, userId: dto.managerId, role: 'MANAGER' },
          update: { role: 'MANAGER' },
        });
      }
      if (Object.keys(changes).length) {
        await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PROJECT, entityId: id, action: 'project.updated', actorId: auth.userId, changes }, tx);
      }
      return updated;
    });
  }

  async remove(auth: AuthContext, id: string) {
    await this.projectAccess.require(auth, id, 'manage');
    await this.prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PROJECT, entityId: id, action: 'project.deleted', actorId: auth.userId });
    await this.audit.forUser(auth, 'project.deleted', { entityType: 'project', entityId: id });
    return { ok: true };
  }

  async addMember(auth: AuthContext, projectId: string, dto: AddMemberDto) {
    await this.projectAccess.require(auth, projectId, 'manage');
    await this.assertOrgUsers(auth, [dto.userId]);
    const m = await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: dto.userId } },
      create: { projectId, userId: dto.userId, role: dto.role ?? 'MEMBER' },
      update: { role: dto.role ?? 'MEMBER' },
    });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PROJECT, entityId: projectId, action: 'project.member.added', actorId: auth.userId, changes: { userId: dto.userId, role: m.role } });
    return m;
  }

  async removeMember(auth: AuthContext, projectId: string, userId: string) {
    const project = await this.projectAccess.require(auth, projectId, 'manage');
    if (project.managerId === userId) throw new BadRequestException('프로젝트 관리자는 제거할 수 없습니다. 먼저 관리자를 변경하세요.');
    await this.prisma.projectMember.deleteMany({ where: { projectId, userId } });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PROJECT, entityId: projectId, action: 'project.member.removed', actorId: auth.userId, changes: { userId } });
    return { ok: true };
  }

  async addMilestone(auth: AuthContext, projectId: string, dto: MilestoneDto) {
    await this.projectAccess.require(auth, projectId, 'edit');
    const position = await this.prisma.milestone.count({ where: { projectId } });
    return this.prisma.milestone.create({ data: { projectId, name: dto.name, description: dto.description, dueDate: d(dto.dueDate), status: dto.status, position } });
  }

  async updateMilestone(auth: AuthContext, projectId: string, milestoneId: string, dto: UpdateMilestoneDto) {
    await this.projectAccess.require(auth, projectId, 'edit');
    const r = await this.prisma.milestone.updateMany({
      where: { id: milestoneId, projectId },
      data: { name: dto.name, description: dto.description, dueDate: d(dto.dueDate), status: dto.status },
    });
    if (!r.count) throw new NotFoundException('마일스톤을 찾을 수 없습니다.');
    return this.prisma.milestone.findUnique({ where: { id: milestoneId } });
  }

  async removeMilestone(auth: AuthContext, projectId: string, milestoneId: string) {
    await this.projectAccess.require(auth, projectId, 'edit');
    await this.prisma.milestone.deleteMany({ where: { id: milestoneId, projectId } });
    return { ok: true };
  }

  async addStatus(auth: AuthContext, projectId: string, dto: CustomStatusDto) {
    await this.projectAccess.require(auth, projectId, 'manage');
    return this.prisma.projectTaskStatus.create({ data: { projectId, name: dto.name, category: dto.category, color: dto.color, position: dto.position ?? 0 } });
  }

  async removeStatus(auth: AuthContext, projectId: string, statusId: string) {
    await this.projectAccess.require(auth, projectId, 'manage');
    await this.prisma.projectTaskStatus.deleteMany({ where: { id: statusId, projectId } });
    return { ok: true };
  }

  async addLink(auth: AuthContext, projectId: string, dto: LinkDto) {
    await this.projectAccess.require(auth, projectId, 'edit');
    if (dto.targetType === 'PAGE') {
      const ok = await this.prisma.page.count({ where: { id: dto.targetId, organizationId: auth.organizationId, deletedAt: null } });
      if (!ok) throw new BadRequestException('문서를 찾을 수 없습니다.');
    }
    return this.prisma.entityLink.upsert({
      where: { sourceType_sourceId_targetType_targetId: { sourceType: 'PROJECT', sourceId: projectId, targetType: dto.targetType, targetId: dto.targetId } },
      create: { organizationId: auth.organizationId, sourceType: 'PROJECT', sourceId: projectId, targetType: dto.targetType, targetId: dto.targetId, createdById: auth.userId },
      update: {},
    });
  }

  async removeLink(auth: AuthContext, projectId: string, linkId: string) {
    await this.projectAccess.require(auth, projectId, 'edit');
    await this.prisma.entityLink.deleteMany({ where: { id: linkId, sourceType: 'PROJECT', sourceId: projectId } });
    return { ok: true };
  }

  async activityLog(auth: AuthContext, projectId: string) {
    await this.projectAccess.require(auth, projectId, 'view');
    const taskIds = (await this.prisma.task.findMany({ where: { projectId }, select: { id: true } })).map((t) => t.id);
    const logs = await this.prisma.activityLog.findMany({
      where: {
        organizationId: auth.organizationId,
        OR: [{ entityType: 'PROJECT', entityId: projectId }, { entityType: 'TASK', entityId: { in: taskIds } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const actorIds = [...new Set(logs.map((l) => l.actorId).filter(Boolean))] as string[];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return logs.map((l) => ({ ...l, actor: l.actorId ? byId.get(l.actorId) ?? null : null }));
  }

  /** 프로젝트 진행률 = 완료된 최상위 업무 / 전체 최상위 업무 */
  static async recalcProgress(tx: Prisma.TransactionClient, projectId: string) {
    const [total, done] = await Promise.all([
      tx.task.count({ where: { projectId, deletedAt: null, parentId: null } }),
      tx.task.count({ where: { projectId, deletedAt: null, parentId: null, status: 'DONE' } }),
    ]);
    const progress = total === 0 ? 0 : Math.round((done / total) * 100);
    await tx.project.update({ where: { id: projectId }, data: { progress } });
  }
}
