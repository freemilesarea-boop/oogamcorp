import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CalendarEvent, EntityType, NotificationType, Prisma } from '@prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { NotifyService } from '../../common/notify/notify.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { eventVisibleWhere, grantedIds, taskVisibleWhere } from '../search/visibility';
import { CreateEventDto, EventRangeQueryDto, RespondDto, UpdateEventDto } from './dto/calendar.dto';

const MAX_RANGE_DAYS = 400;
const userSelect = { select: { id: true, name: true, email: true, avatarUrl: true } } as const;
const eventInclude = {
  attendees: { select: { userId: true, response: true, user: userSelect }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CalendarEventInclude;
type EventWithAttendees = Prisma.CalendarEventGetPayload<{ include: typeof eventInclude }>;

/** 종일 일정은 날짜(YYYY-MM-DD) 기준으로 UTC 00:00 ~ 23:59:59.999 로 정규화한다 */
function normalizeTimes(startAt: string, endAt: string, allDay: boolean) {
  const start = allDay ? new Date(`${startAt.slice(0, 10)}T00:00:00.000Z`) : new Date(startAt);
  const end = allDay ? new Date(`${endAt.slice(0, 10)}T23:59:59.999Z`) : new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestException('일시 형식이 올바르지 않습니다.');
  if (end < start) throw new BadRequestException('종료 일시는 시작 일시 이후여야 합니다.');
  return { start, end };
}

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly activity: ActivityService,
    private readonly notify: NotifyService,
  ) {}

  private present(auth: AuthContext, e: EventWithAttendees) {
    const { attendees, ...rest } = e;
    const mine = attendees.find((a) => a.userId === auth.userId);
    return {
      ...rest,
      attendees: attendees.map((a) => ({ ...a.user, response: a.response })),
      myResponse: mine?.response ?? null,
      canEdit: e.createdById === auth.userId,
      recurrenceExpanded: false,
    };
  }

  private async requireEvent(auth: AuthContext, id: string, need: 'view' | 'edit') {
    const ev = await this.prisma.calendarEvent.findFirst({ where: { AND: [{ id }, eventVisibleWhere(auth)] }, include: eventInclude });
    if (!ev) throw new NotFoundException('일정을 찾을 수 없습니다.');
    if (need === 'edit' && ev.createdById !== auth.userId) throw new ForbiddenException('일정 작성자만 수정할 수 있습니다.');
    return ev;
  }

  private async assertRefs(auth: AuthContext, dto: { attendeeIds?: string[]; projectId?: string | null; departmentId?: string | null }) {
    if (dto.attendeeIds?.length) {
      const ids = [...new Set(dto.attendeeIds)];
      const count = await this.prisma.membership.count({ where: { organizationId: auth.organizationId, userId: { in: ids } } });
      if (count !== ids.length) throw new BadRequestException('조직에 속하지 않은 참석자가 포함되어 있습니다.');
    }
    if (dto.projectId) await this.projectAccess.require(auth, dto.projectId, 'view').catch(() => {
      throw new BadRequestException('연결할 수 없는 프로젝트입니다.');
    });
    if (dto.departmentId) {
      const ok = await this.prisma.department.count({ where: { id: dto.departmentId, organizationId: auth.organizationId, deletedAt: null } });
      if (!ok) throw new BadRequestException('부서를 찾을 수 없습니다.');
    }
  }

  private link(id: string) {
    return `/admin/calendar?event=${id}`;
  }

  async range(auth: AuthContext, q: EventRangeQueryDto) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to <= from) throw new BadRequestException('to 는 from 이후여야 합니다.');
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) throw new BadRequestException(`조회 범위는 최대 ${MAX_RANGE_DAYS}일입니다.`);
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        AND: [
          eventVisibleWhere(auth),
          { startAt: { lt: to }, endAt: { gte: from } },
          q.mine === 'true' ? { OR: [{ createdById: auth.userId }, { attendees: { some: { userId: auth.userId } } }] } : {},
        ],
      },
      include: eventInclude,
      orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
      take: 2000,
    });
    let tasks: { id: string; title: string; dueDate: Date | null; status: string; priority: string; project: { id: string; key: string; name: string } | null; href: string }[] = [];
    if (q.include === 'tasks' && auth.permissions.has('projects.read')) {
      const scope: Prisma.TaskWhereInput = q.taskScope === 'visible'
        ? taskVisibleWhere(auth, await grantedIds(this.prisma, auth, 'PROJECT'))
        : {
            organizationId: auth.organizationId,
            deletedAt: null,
            OR: [{ assignees: { some: { userId: auth.userId } } }, { projectId: null, createdById: auth.userId }],
          };
      const rows = await this.prisma.task.findMany({
        where: { AND: [scope, { dueDate: { gte: new Date(q.from.slice(0, 10)), lte: to } }] },
        select: { id: true, title: true, dueDate: true, status: true, priority: true, project: { select: { id: true, key: true, name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 1000,
      });
      tasks = rows.map((t) => ({ ...t, href: t.project ? `/admin/projects/${t.project.id}?task=${t.id}` : `/admin/my-tasks?task=${t.id}` }));
    }
    return { events: events.map((e) => this.present(auth, e)), tasks };
  }

  async get(auth: AuthContext, id: string) {
    return this.present(auth, await this.requireEvent(auth, id, 'view'));
  }

  /** 내가 아직 응답하지 않은 다가오는 초대 */
  async invitations(auth: AuthContext) {
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        organizationId: auth.organizationId,
        deletedAt: null,
        endAt: { gte: new Date() },
        attendees: { some: { userId: auth.userId, response: 'PENDING' } },
        createdById: { not: auth.userId },
      },
      include: eventInclude,
      orderBy: { startAt: 'asc' },
      take: 50,
    });
    return events.map((e) => this.present(auth, e));
  }

  async create(auth: AuthContext, dto: CreateEventDto) {
    await this.assertRefs(auth, dto);
    const { start, end } = normalizeTimes(dto.startAt, dto.endAt, !!dto.allDay);
    const attendeeIds = [...new Set(dto.attendeeIds ?? [])];
    const ev = await this.prisma.$transaction(async (tx) => {
      const created = await tx.calendarEvent.create({
        data: {
          organizationId: auth.organizationId,
          title: dto.title,
          description: dto.description,
          location: dto.location,
          startAt: start,
          endAt: end,
          allDay: !!dto.allDay,
          isPrivate: !!dto.isPrivate,
          projectId: dto.projectId,
          departmentId: dto.departmentId,
          recurrence: dto.recurrence,
          createdById: auth.userId,
        },
      });
      if (attendeeIds.length) {
        await tx.eventAttendee.createMany({
          data: attendeeIds.map((userId) => ({ eventId: created.id, userId, response: userId === auth.userId ? 'ACCEPTED' : 'PENDING' })),
        });
      }
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.EVENT, entityId: created.id, action: 'event.created', actorId: auth.userId, changes: { title: dto.title } }, tx);
      await this.notify.send({
        organizationId: auth.organizationId,
        userIds: attendeeIds,
        type: NotificationType.SYSTEM,
        title: `일정 초대: ${dto.title}`,
        body: `${auth.name}님이 일정에 초대했습니다.`,
        link: this.link(created.id),
        entityType: EntityType.EVENT,
        entityId: created.id,
        actorId: auth.userId,
      }, tx);
      return created;
    });
    return this.get(auth, ev.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateEventDto) {
    const before = await this.requireEvent(auth, id, 'edit');
    await this.assertRefs(auth, dto);
    const allDay = dto.allDay ?? before.allDay;
    const timesChanged = dto.startAt !== undefined || dto.endAt !== undefined || dto.allDay !== undefined;
    const { start, end } = timesChanged
      ? normalizeTimes(dto.startAt ?? before.startAt.toISOString(), dto.endAt ?? before.endAt.toISOString(), allDay)
      : { start: before.startAt, end: before.endAt };
    const data: Prisma.CalendarEventUncheckedUpdateInput = {
      title: dto.title,
      description: dto.description,
      location: dto.location,
      startAt: start,
      endAt: end,
      allDay,
      isPrivate: dto.isPrivate,
      projectId: dto.projectId,
      departmentId: dto.departmentId,
      recurrence: dto.recurrence,
    };
    const changes = ActivityService.diff(before as unknown as Record<string, unknown>, data as Record<string, unknown>);
    const existing = new Set(before.attendees.map((a) => a.userId));
    const nextIds = dto.attendeeIds ? [...new Set(dto.attendeeIds)] : null;
    const added = nextIds ? nextIds.filter((u) => !existing.has(u)) : [];
    const removed = nextIds ? [...existing].filter((u) => !nextIds.includes(u)) : [];
    await this.prisma.$transaction(async (tx) => {
      await tx.calendarEvent.update({ where: { id }, data });
      if (removed.length) await tx.eventAttendee.deleteMany({ where: { eventId: id, userId: { in: removed } } });
      if (added.length) {
        await tx.eventAttendee.createMany({ data: added.map((userId) => ({ eventId: id, userId, response: userId === auth.userId ? 'ACCEPTED' : 'PENDING' })), skipDuplicates: true });
      }
      if (Object.keys(changes).length || added.length || removed.length) {
        await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.EVENT, entityId: id, action: 'event.updated', actorId: auth.userId, changes: { ...changes, ...(added.length ? { attendeesAdded: added } : {}), ...(removed.length ? { attendeesRemoved: removed } : {}) } }, tx);
      }
      const title = dto.title ?? before.title;
      await this.notify.send({ organizationId: auth.organizationId, userIds: added, type: NotificationType.SYSTEM, title: `일정 초대: ${title}`, body: `${auth.name}님이 일정에 초대했습니다.`, link: this.link(id), entityType: EntityType.EVENT, entityId: id, actorId: auth.userId }, tx);
      // 일시/장소가 바뀌면 기존 참석자에게 변경 알림
      if (changes.startAt || changes.endAt || changes.location) {
        const keep = [...existing].filter((u) => !removed.includes(u));
        await this.notify.send({ organizationId: auth.organizationId, userIds: keep, type: NotificationType.SYSTEM, title: `일정 변경: ${title}`, body: '일정의 일시 또는 장소가 변경되었습니다.', link: this.link(id), entityType: EntityType.EVENT, entityId: id, actorId: auth.userId }, tx);
      }
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    const ev = await this.requireEvent(auth, id, 'edit');
    await this.prisma.calendarEvent.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.EVENT, entityId: id, action: 'event.deleted', actorId: auth.userId, changes: { title: ev.title } });
    await this.notify.send({
      organizationId: auth.organizationId, userIds: ev.attendees.map((a) => a.userId), type: NotificationType.SYSTEM,
      title: `일정 취소: ${ev.title}`, body: `${auth.name}님이 일정을 취소했습니다.`, entityType: EntityType.EVENT, entityId: id, actorId: auth.userId,
    });
    return { ok: true };
  }

  async respond(auth: AuthContext, id: string, dto: RespondDto) {
    const ev: CalendarEvent & { attendees: { userId: string }[] } = await this.requireEvent(auth, id, 'view');
    if (!ev.attendees.some((a) => a.userId === auth.userId)) throw new ForbiddenException('초대받은 참석자만 응답할 수 있습니다.');
    await this.prisma.eventAttendee.update({ where: { eventId_userId: { eventId: id, userId: auth.userId } }, data: { response: dto.response } });
    const label = { ACCEPTED: '수락', DECLINED: '거절', TENTATIVE: '미정', PENDING: '대기' }[dto.response];
    await this.notify.send({
      organizationId: auth.organizationId, userIds: [ev.createdById], type: NotificationType.SYSTEM,
      title: `${auth.name}님이 일정에 ${label}했습니다`, body: ev.title, link: this.link(id), entityType: EntityType.EVENT, entityId: id, actorId: auth.userId,
    });
    return this.get(auth, id);
  }
}
