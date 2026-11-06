import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AnnouncementsService } from '../announcements/announcements.service';
import { visibleProjectWhere } from '../employees/project-visibility';

/** 한국 표준시 기준 날짜 (업무 마감일은 DATE 컬럼 — UTC 자정으로 저장됨) */
export function kstToday(now = new Date()): Date {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}

const DAY = 86400_000;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly announcements: AnnouncementsService,
  ) {}

  async get(auth: AuthContext) {
    const can = (p: Parameters<typeof auth.permissions.has>[0]) => auth.permissions.has(p);
    const [tasks, projects, approvals, documents, announcements, unreadNotifications, finance] = await Promise.all([
      this.tasks(auth),
      can('projects.read') ? this.projects(auth) : Promise.resolve([]),
      this.approvals(auth),
      can('docs.read') ? this.documents(auth) : Promise.resolve([]),
      can('announcements.read') ? this.announcements.latest(auth, 5) : Promise.resolve([]),
      this.prisma.notification.count({ where: { userId: auth.userId, organizationId: auth.organizationId, readAt: null } }),
      can('finance.read') ? this.finance(auth) : Promise.resolve(null),
    ]);
    return { tasks, projects, approvals, documents, announcements, unreadNotifications, finance };
  }

  private async tasks(auth: AuthContext) {
    const today = kstToday();
    const tomorrow = new Date(today.getTime() + DAY);
    const weekEnd = new Date(today.getTime() + 8 * DAY);
    const base: Prisma.TaskWhereInput = {
      organizationId: auth.organizationId,
      deletedAt: null,
      status: { not: 'DONE' },
      assignees: { some: { userId: auth.userId } },
      OR: [{ projectId: null }, { project: { deletedAt: null } }],
    };
    const [open, overdue, dueToday, dueWeek, upcoming] = await Promise.all([
      this.prisma.task.count({ where: base }),
      this.prisma.task.count({ where: { ...base, dueDate: { lt: today } } }),
      this.prisma.task.count({ where: { ...base, dueDate: { gte: today, lt: tomorrow } } }),
      this.prisma.task.count({ where: { ...base, dueDate: { gte: today, lt: weekEnd } } }),
      this.prisma.task.findMany({
        where: base,
        select: { id: true, title: true, status: true, priority: true, dueDate: true, project: { select: { id: true, key: true, name: true } } },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }],
        take: 8,
      }),
    ]);
    return { open, overdue, today: dueToday, week: dueWeek, upcoming };
  }

  private async projects(auth: AuthContext) {
    const visible = await visibleProjectWhere(this.prisma, auth);
    return this.prisma.project.findMany({
      where: { AND: [visible, { OR: [{ managerId: auth.userId }, { members: { some: { userId: auth.userId } } }] }] },
      select: {
        id: true, key: true, name: true, status: true, progress: true, endDate: true, updatedAt: true,
        _count: { select: { tasks: { where: { deletedAt: null, status: { not: 'DONE' } } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
  }

  private async approvals(auth: AuthContext) {
    const where: Prisma.ApprovalStepWhereInput = {
      approverId: auth.userId,
      status: 'PENDING',
      request: { organizationId: auth.organizationId, status: 'PENDING', deletedAt: null },
    };
    const [count, steps] = await Promise.all([
      this.prisma.approvalStep.count({ where }),
      this.prisma.approvalStep.findMany({
        where,
        orderBy: { request: { submittedAt: 'asc' } },
        take: 5,
        select: {
          id: true,
          order: true,
          request: { select: { id: true, number: true, title: true, type: true, submittedAt: true, requesterId: true } },
        },
      }),
    ]);
    const requesters = await this.prisma.user.findMany({ where: { id: { in: steps.map((s) => s.request.requesterId) } }, select: { id: true, name: true } });
    const r = new Map(requesters.map((u) => [u.id, u]));
    return {
      count,
      items: steps.map((s) => ({ stepId: s.id, order: s.order, ...s.request, requester: r.get(s.request.requesterId) ?? null })),
    };
  }

  /** 최근 문서: 본인이 작성했거나 마지막으로 수정한 문서 (접근 가능성이 보장되는 범위) */
  private documents(auth: AuthContext) {
    return this.prisma.page.findMany({
      where: {
        organizationId: auth.organizationId,
        deletedAt: null,
        isTemplate: false,
        OR: [{ createdById: auth.userId }, { updatedById: auth.userId }],
      },
      select: { id: true, title: true, icon: true, updatedAt: true, workspaceId: true },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    });
  }

  /** 재무 KPI (finance.read 보유자만): 이번 달 승인된 매출/지출 — Decimal 연산 */
  private async finance(auth: AuthContext) {
    const today = kstToday();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    const prevStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const sum = async (type: 'REVENUE' | 'EXPENSE', from: Date, to: Date) => {
      const r = await this.prisma.financialTransaction.aggregate({
        where: { organizationId: auth.organizationId, deletedAt: null, status: 'APPROVED', type, txDate: { gte: from, lt: to } },
        _sum: { totalAmount: true },
      });
      return r._sum.totalAmount ?? new Prisma.Decimal(0);
    };
    const [rev, exp, prevRev, prevExp] = await Promise.all([
      sum('REVENUE', monthStart, nextMonth),
      sum('EXPENSE', monthStart, nextMonth),
      sum('REVENUE', prevStart, monthStart),
      sum('EXPENSE', prevStart, monthStart),
    ]);
    return {
      month: `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`,
      currency: 'KRW',
      revenue: rev.toFixed(2),
      expense: exp.toFixed(2),
      net: rev.minus(exp).toFixed(2),
      previous: { revenue: prevRev.toFixed(2), expense: prevExp.toFixed(2), net: prevRev.minus(prevExp).toFixed(2) },
    };
  }
}
