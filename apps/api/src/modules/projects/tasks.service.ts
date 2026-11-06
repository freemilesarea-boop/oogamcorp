import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityType, Prisma, Task, TaskStatus } from '@prisma/client';
import { TASK_STATUS_LABELS } from '@oogam/shared';
import { ActivityService } from '../../common/activity/activity.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { NotifyService } from '../../common/notify/notify.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LinkDto } from './dto/project.dto';
import { BulkPositionDto, CreateTaskDto, TaskQueryDto, UpdateTaskDto } from './dto/task.dto';
import { ProjectAccessService } from './project-access.service';
import { ProjectsRepository, taskInclude } from './projects.repository';
import { ProjectsService } from './projects.service';

const d = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProjectsRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly activity: ActivityService,
    private readonly notify: NotifyService,
  ) {}

  /** 업무 접근 확인: 프로젝트 업무는 프로젝트 권한, 개인 업무는 작성자/담당자 */
  private async requireTask(auth: AuthContext, id: string, needed: 'view' | 'edit'): Promise<Task> {
    const task = await this.prisma.task.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null } });
    if (!task) throw new NotFoundException('업무를 찾을 수 없습니다.');
    if (task.projectId) {
      try {
        await this.projectAccess.require(auth, task.projectId, needed);
      } catch (e) {
        // 담당자는 프로젝트 권한이 view 라도 자신의 업무를 편집할 수 있다
        const assigned = await this.prisma.taskAssignee.count({ where: { taskId: id, userId: auth.userId } });
        if (!assigned) throw e;
      }
      return task;
    }
    if (task.createdById === auth.userId) return task;
    const assigned = await this.prisma.taskAssignee.count({ where: { taskId: id, userId: auth.userId } });
    if (assigned) return task;
    throw new NotFoundException('업무를 찾을 수 없습니다.');
  }

  private async assertAssignees(auth: AuthContext, ids: string[] | undefined) {
    if (!ids?.length) return;
    const unique = [...new Set(ids)];
    const count = await this.prisma.membership.count({ where: { organizationId: auth.organizationId, userId: { in: unique } } });
    if (count !== unique.length) throw new BadRequestException('조직에 속하지 않은 담당자가 포함되어 있습니다.');
  }

  async list(auth: AuthContext, q: TaskQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const visibleProjects = this.repo.visibleWhere(auth, await this.repo.grantedProjectIds(auth));
    const where: Prisma.TaskWhereInput = {
      organizationId: auth.organizationId,
      deletedAt: null,
      AND: [
        q.projectId ? { projectId: q.projectId } : {},
        {
          OR: [
            { project: visibleProjects },
            { projectId: null, createdById: auth.userId },
            { assignees: { some: { userId: auth.userId } } },
          ],
        },
        q.status ? { status: q.status } : {},
        q.includeDone === 'false' ? { status: { not: TaskStatus.DONE } } : {},
        q.priority ? { priority: q.priority } : {},
        q.milestoneId ? { milestoneId: q.milestoneId } : {},
        q.assigneeId ? { assignees: { some: { userId: q.assigneeId } } } : {},
        q.parentId === 'root' ? { parentId: null } : q.parentId ? { parentId: q.parentId } : {},
        q.dueFrom || q.dueTo ? { dueDate: { gte: d(q.dueFrom) ?? undefined, lte: d(q.dueTo) ?? undefined } } : {},
        q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {},
      ],
    };
    const orderBy = q.sort
      ? orderByArg(q, ['createdAt', 'updatedAt', 'dueDate', 'priority', 'title', 'position'] as const, 'position')
      : [{ position: 'asc' as const }, { createdAt: 'desc' as const }];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({ where, skip, take, orderBy, include: taskInclude }),
      this.prisma.task.count({ where }),
    ]);
    return paginated(items.map(flatten), total, page, pageSize);
  }

  async myTasks(auth: AuthContext, includeDone: boolean) {
    const items = await this.prisma.task.findMany({
      where: {
        organizationId: auth.organizationId,
        deletedAt: null,
        assignees: { some: { userId: auth.userId } },
        ...(includeDone ? {} : { status: { not: TaskStatus.DONE } }),
        OR: [{ projectId: null }, { project: { deletedAt: null } }],
      },
      include: taskInclude,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }],
      take: 500,
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today.getTime() + 7 * 86400_000);
    const groups = { overdue: [] as unknown[], today: [] as unknown[], week: [] as unknown[], later: [] as unknown[], noDue: [] as unknown[], done: [] as unknown[] };
    for (const t of items.map(flatten)) {
      if (t.status === 'DONE') groups.done.push(t);
      else if (!t.dueDate) groups.noDue.push(t);
      else if (t.dueDate < today) groups.overdue.push(t);
      else if (t.dueDate.getTime() === today.getTime()) groups.today.push(t);
      else if (t.dueDate <= weekEnd) groups.week.push(t);
      else groups.later.push(t);
    }
    return { total: items.length, groups };
  }

  async create(auth: AuthContext, dto: CreateTaskDto) {
    let projectId = dto.projectId ?? null;
    if (dto.parentId) {
      const parent = await this.requireTask(auth, dto.parentId, 'edit');
      if (projectId && parent.projectId !== projectId) throw new BadRequestException('상위 업무와 프로젝트가 다릅니다.');
      projectId = parent.projectId;
    }
    if (projectId) await this.projectAccess.require(auth, projectId, 'edit');
    await this.assertAssignees(auth, dto.assigneeIds);
    if (dto.milestoneId) {
      const ok = projectId && (await this.prisma.milestone.count({ where: { id: dto.milestoneId, projectId } }));
      if (!ok) throw new BadRequestException('마일스톤이 프로젝트에 속하지 않습니다.');
    }
    const status = await this.resolveStatus(projectId, dto.status, dto.customStatusId);

    const task = await this.prisma.$transaction(async (tx) => {
      const last = await tx.task.findFirst({ where: { projectId, parentId: dto.parentId ?? null, status: status.status }, orderBy: { position: 'desc' }, select: { position: true } });
      const t = await tx.task.create({
        data: {
          organizationId: auth.organizationId,
          projectId,
          parentId: dto.parentId,
          milestoneId: dto.milestoneId,
          title: dto.title,
          description: dto.description,
          status: status.status,
          customStatusId: status.customStatusId,
          priority: dto.priority,
          startDate: d(dto.startDate),
          dueDate: d(dto.dueDate),
          checklist: (dto.checklist ?? []) as unknown as Prisma.InputJsonValue,
          position: (last?.position ?? 0) + 1000,
          createdById: auth.userId,
          completedAt: status.status === 'DONE' ? new Date() : null,
          assignees: dto.assigneeIds?.length ? { create: [...new Set(dto.assigneeIds)].map((userId) => ({ userId })) } : undefined,
        },
        include: taskInclude,
      });
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.TASK, entityId: t.id, action: 'task.created', actorId: auth.userId, changes: { title: t.title, projectId } }, tx);
      if (projectId) await ProjectsService.recalcProgress(tx, projectId);
      if (dto.assigneeIds?.length) {
        await this.notify.send({
          organizationId: auth.organizationId,
          userIds: dto.assigneeIds,
          actorId: auth.userId,
          type: 'TASK_ASSIGNED',
          title: `새 업무가 배정되었습니다: ${t.title}`,
          body: `${auth.name} 님이 업무를 배정했습니다.`,
          link: `/admin/my-tasks?task=${t.id}`,
          entityType: 'TASK',
          entityId: t.id,
        }, tx);
      }
      return t;
    });
    return flatten(task);
  }

  private async resolveStatus(projectId: string | null, status?: TaskStatus, customStatusId?: string | null) {
    if (customStatusId) {
      const cs = projectId ? await this.prisma.projectTaskStatus.findFirst({ where: { id: customStatusId, projectId } }) : null;
      if (!cs) throw new BadRequestException('사용자 정의 상태가 프로젝트에 속하지 않습니다.');
      return { status: cs.category, customStatusId: cs.id };
    }
    return { status: status ?? TaskStatus.TODO, customStatusId: customStatusId === null ? null : undefined };
  }

  async get(auth: AuthContext, id: string) {
    await this.requireTask(auth, id, 'view');
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id },
      include: {
        ...taskInclude,
        milestone: { select: { id: true, name: true } },
        subtasks: { where: { deletedAt: null }, include: taskInclude, orderBy: { position: 'asc' } },
        dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
        parent: { select: { id: true, title: true } },
      },
    });
    const links = await this.prisma.entityLink.findMany({ where: { sourceType: 'TASK', sourceId: id } });
    const pageIds = links.filter((l) => l.targetType === 'PAGE').map((l) => l.targetId);
    const pages = pageIds.length ? await this.prisma.page.findMany({ where: { id: { in: pageIds }, deletedAt: null }, select: { id: true, title: true, icon: true } }) : [];
    const history = await this.activity.list(auth.organizationId, 'TASK', id, 50);
    return {
      ...flatten(task),
      milestone: task.milestone,
      parent: task.parent,
      subtasks: task.subtasks.map(flatten),
      dependencies: task.dependencies.map((x) => ({ id: x.id, task: x.dependsOn })),
      documents: pages.map((p) => ({ ...p, linkId: links.find((l) => l.targetId === p.id)?.id })),
      history,
    };
  }

  async update(auth: AuthContext, id: string, dto: UpdateTaskDto) {
    const before = await this.requireTask(auth, id, 'edit');
    await this.assertAssignees(auth, dto.assigneeIds);
    if (dto.milestoneId) {
      const ok = before.projectId && (await this.prisma.milestone.count({ where: { id: dto.milestoneId, projectId: before.projectId } }));
      if (!ok) throw new BadRequestException('마일스톤이 프로젝트에 속하지 않습니다.');
    }
    let status: TaskStatus | undefined = dto.status;
    let customStatusId: string | null | undefined = dto.customStatusId;
    if (dto.customStatusId !== undefined || dto.status !== undefined) {
      const r = await this.resolveStatus(before.projectId, dto.status ?? before.status, dto.customStatusId);
      status = r.status;
      customStatusId = dto.customStatusId === undefined && dto.status !== undefined ? null : r.customStatusId;
    }
    const data: Prisma.TaskUncheckedUpdateInput = {
      title: dto.title,
      description: dto.description,
      status,
      customStatusId,
      priority: dto.priority,
      milestoneId: dto.milestoneId,
      startDate: d(dto.startDate),
      dueDate: d(dto.dueDate),
      position: dto.position,
      checklist: dto.checklist as unknown as Prisma.InputJsonValue | undefined,
    };
    if (status && status !== before.status) data.completedAt = status === 'DONE' ? new Date() : null;
    const changes = ActivityService.diff(before as unknown as Record<string, unknown>, { ...data, checklist: undefined, completedAt: undefined } as Record<string, unknown>);

    return this.prisma.$transaction(async (tx) => {
      let newAssignees: string[] = [];
      if (dto.assigneeIds) {
        const current = (await tx.taskAssignee.findMany({ where: { taskId: id }, select: { userId: true } })).map((a) => a.userId);
        const next = [...new Set(dto.assigneeIds)];
        newAssignees = next.filter((u) => !current.includes(u));
        const removed = current.filter((u) => !next.includes(u));
        if (removed.length) await tx.taskAssignee.deleteMany({ where: { taskId: id, userId: { in: removed } } });
        if (newAssignees.length) await tx.taskAssignee.createMany({ data: newAssignees.map((userId) => ({ taskId: id, userId })) });
        if (newAssignees.length || removed.length) changes.assignees = { from: current, to: next };
      }
      const t = await tx.task.update({ where: { id }, data, include: taskInclude });
      if (status && status !== before.status) changes.status = { from: TASK_STATUS_LABELS[before.status], to: TASK_STATUS_LABELS[status] };
      if (dto.checklist) changes.checklist = { from: null, to: `${dto.checklist.filter((c) => c.done).length}/${dto.checklist.length}` };
      if (Object.keys(changes).length) {
        await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.TASK, entityId: id, action: 'task.updated', actorId: auth.userId, changes }, tx);
      }
      if (t.projectId && status && status !== before.status) await ProjectsService.recalcProgress(tx, t.projectId);
      if (newAssignees.length) {
        await this.notify.send({
          organizationId: auth.organizationId, userIds: newAssignees, actorId: auth.userId, type: 'TASK_ASSIGNED',
          title: `업무가 배정되었습니다: ${t.title}`, link: `/admin/my-tasks?task=${t.id}`, entityType: 'TASK', entityId: t.id,
        }, tx);
      }
      return flatten(t);
    });
  }

  async reorder(auth: AuthContext, dto: BulkPositionDto) {
    const ids = dto.items.map((i) => i.id);
    for (const id of ids) await this.requireTask(auth, id, 'edit');
    await this.prisma.$transaction(
      dto.items.map((i) =>
        this.prisma.task.update({
          where: { id: i.id },
          data: { position: i.position, ...(i.status ? { status: i.status, customStatusId: null, completedAt: i.status === 'DONE' ? new Date() : null } : {}) },
        }),
      ),
    );
    const projectIds = await this.prisma.task.findMany({ where: { id: { in: ids } }, select: { projectId: true }, distinct: ['projectId'] });
    for (const p of projectIds) if (p.projectId) await ProjectsService.recalcProgress(this.prisma, p.projectId);
    return { ok: true };
  }

  async remove(auth: AuthContext, id: string) {
    const task = await this.requireTask(auth, id, 'edit');
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.task.updateMany({ where: { OR: [{ id }, { parentId: id }] }, data: { deletedAt: now } });
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.TASK, entityId: id, action: 'task.deleted', actorId: auth.userId }, tx);
      if (task.projectId) await ProjectsService.recalcProgress(tx, task.projectId);
    });
    return { ok: true };
  }

  async addDependency(auth: AuthContext, id: string, dependsOnId: string) {
    if (id === dependsOnId) throw new BadRequestException('자기 자신에 의존할 수 없습니다.');
    const task = await this.requireTask(auth, id, 'edit');
    const other = await this.requireTask(auth, dependsOnId, 'view');
    if (task.projectId !== other.projectId) throw new BadRequestException('같은 프로젝트의 업무만 연결할 수 있습니다.');
    // 순환 의존 방지 (BFS)
    const seen = new Set<string>();
    const queue = [dependsOnId];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === id) throw new BadRequestException('순환 의존이 발생합니다.');
      if (seen.has(cur)) continue;
      seen.add(cur);
      const deps = await this.prisma.taskDependency.findMany({ where: { taskId: cur }, select: { dependsOnId: true } });
      queue.push(...deps.map((x) => x.dependsOnId));
    }
    return this.prisma.taskDependency.upsert({
      where: { taskId_dependsOnId: { taskId: id, dependsOnId } },
      create: { taskId: id, dependsOnId },
      update: {},
    });
  }

  async removeDependency(auth: AuthContext, id: string, depId: string) {
    await this.requireTask(auth, id, 'edit');
    await this.prisma.taskDependency.deleteMany({ where: { id: depId, taskId: id } });
    return { ok: true };
  }

  async addLink(auth: AuthContext, id: string, dto: LinkDto) {
    await this.requireTask(auth, id, 'edit');
    if (dto.targetType === 'PAGE') {
      const ok = await this.prisma.page.count({ where: { id: dto.targetId, organizationId: auth.organizationId, deletedAt: null } });
      if (!ok) throw new BadRequestException('문서를 찾을 수 없습니다.');
    }
    return this.prisma.entityLink.upsert({
      where: { sourceType_sourceId_targetType_targetId: { sourceType: 'TASK', sourceId: id, targetType: dto.targetType, targetId: dto.targetId } },
      create: { organizationId: auth.organizationId, sourceType: 'TASK', sourceId: id, targetType: dto.targetType, targetId: dto.targetId, createdById: auth.userId },
      update: {},
    });
  }

  async removeLink(auth: AuthContext, id: string, linkId: string) {
    await this.requireTask(auth, id, 'edit');
    await this.prisma.entityLink.deleteMany({ where: { id: linkId, sourceType: 'TASK', sourceId: id } });
    return { ok: true };
  }

  /** 다른 모듈(댓글/파일)에서 업무 접근 확인용 */
  canAccess(auth: AuthContext, id: string, needed: 'view' | 'edit') {
    return this.requireTask(auth, id, needed).then(() => true).catch((e) => {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) return false;
      throw e;
    });
  }
}

type TaskWithInclude = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

function flatten<T extends TaskWithInclude>(t: T) {
  const { assignees, _count, ...rest } = t;
  return { ...rest, assignees: assignees.map((a) => a.user), subtaskCount: _count.subtasks };
}
