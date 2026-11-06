import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FinanceRepository, fromMinor, minorOf, money, rate } from './finance.repository';

/**
 * 재무 대시보드 집계. 모든 집계는 DB(SQL groupBy / 매개변수화된 $queryRaw)에서 수행한다.
 * 수입·지출 실적은 승인(APPROVED) 거래만, 부가세 포함 합계(totalAmount) 기준.
 */
@Injectable()
export class FinanceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: FinanceRepository,
  ) {}

  async get(auth: AuthContext, year?: number) {
    const org = auth.organizationId;
    const y = year ?? new Date().getFullYear();
    const start = new Date(Date.UTC(y, 0, 1));
    const end = new Date(Date.UTC(y + 1, 0, 1));
    const inYear: Prisma.FinancialTransactionWhereInput = { organizationId: org, deletedAt: null, txDate: { gte: start, lt: end } };

    const [byTypeStatus, monthlyRows, unitRows, projectRows, pendingList, budgetAgg, budgetLines, units] = await Promise.all([
      this.prisma.financialTransaction.groupBy({
        by: ['type', 'status'],
        where: inYear,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ m: number; type: string; total: Prisma.Decimal | string | null }[]>`
        SELECT EXTRACT(MONTH FROM t."txDate")::int AS m, t."type"::text AS type, SUM(t."totalAmount") AS total
        FROM financial_transactions t
        WHERE t."organizationId" = ${org}::uuid
          AND t."deletedAt" IS NULL
          AND t."status" = 'APPROVED'
          AND t."txDate" >= ${`${y}-01-01`}::date
          AND t."txDate" < ${`${y + 1}-01-01`}::date
        GROUP BY 1, 2`,
      this.prisma.financialTransaction.groupBy({
        by: ['businessUnitId', 'type'],
        where: { ...inYear, status: 'APPROVED' },
        _sum: { totalAmount: true },
      }),
      this.prisma.financialTransaction.groupBy({
        by: ['projectId'],
        where: { ...inYear, status: 'APPROVED', type: 'EXPENSE', projectId: { not: null } },
        _sum: { totalAmount: true },
        _count: { _all: true },
        orderBy: { _sum: { totalAmount: 'desc' } },
        take: 10,
      }),
      this.prisma.financialTransaction.findMany({
        where: { organizationId: org, deletedAt: null, status: 'PENDING', type: 'EXPENSE' },
        orderBy: [{ txDate: 'asc' }, { createdAt: 'asc' }],
        take: 10,
        select: { id: true, txDate: true, description: true, counterparty: true, totalAmount: true, createdById: true, businessUnit: { select: { id: true, name: true } } },
      }),
      this.prisma.budget.aggregate({
        where: { organizationId: org, deletedAt: null, fiscalYear: y, status: { in: ['APPROVED', 'CLOSED'] } },
        _sum: { approvedAmount: true, plannedAmount: true },
        _count: { _all: true },
      }),
      this.prisma.budgetLine.findMany({
        where: { budget: { organizationId: org, deletedAt: null, fiscalYear: y, status: { in: ['APPROVED', 'CLOSED'] } } },
        select: { id: true, budget: { select: { projectId: true } }, approvedAmount: true },
      }),
      this.prisma.businessUnit.findMany({ where: { organizationId: org }, select: { id: true, name: true, code: true, isActive: true }, orderBy: { name: 'asc' } }),
    ]);

    // 합계 / 승인 대기
    let revenue = 0n;
    let expense = 0n;
    let pendingCount = 0;
    let pendingAmount = 0n;
    for (const r of byTypeStatus) {
      const sum = minorOf(r._sum.totalAmount);
      if (r.status === 'APPROVED') {
        if (r.type === 'REVENUE') revenue += sum;
        else expense += sum;
      }
      if (r.status === 'PENDING' && r.type === 'EXPENSE') {
        pendingCount += r._count._all;
        pendingAmount += sum;
      }
    }

    // 예산 집행률 (승인 금액 대비 승인된 지출 배분액)
    const executedByLine = await this.repo.executedByLine(org, budgetLines.map((l) => l.id));
    let executed = 0n;
    for (const v of executedByLine.values()) executed += v;
    const approvedBudget = minorOf(budgetAgg._sum.approvedAmount);

    // 월별 추이 (1~12월)
    const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, revenue: 0n, expense: 0n }));
    for (const r of monthlyRows) {
      const slot = monthly[Number(r.m) - 1];
      if (!slot) continue;
      const v = minorOf(r.total == null ? null : String(r.total));
      if (r.type === 'REVENUE') slot.revenue += v;
      else slot.expense += v;
    }

    // 사업 구분별 실적
    const unitMap = new Map<string | null, { revenue: bigint; expense: bigint }>();
    for (const r of unitRows) {
      const cur = unitMap.get(r.businessUnitId) ?? { revenue: 0n, expense: 0n };
      if (r.type === 'REVENUE') cur.revenue += minorOf(r._sum.totalAmount);
      else cur.expense += minorOf(r._sum.totalAmount);
      unitMap.set(r.businessUnitId, cur);
    }
    const byBusinessUnit = [
      ...units.filter((u) => u.isActive || unitMap.has(u.id)).map((u) => ({ id: u.id as string | null, name: u.name, code: u.code as string | null, ...(unitMap.get(u.id) ?? { revenue: 0n, expense: 0n }) })),
      ...(unitMap.has(null) ? [{ id: null, name: '미지정', code: null, ...unitMap.get(null)! }] : []),
    ].map((u) => ({ id: u.id, name: u.name, code: u.code, revenue: fromMinor(u.revenue), expense: fromMinor(u.expense), profit: fromMinor(u.revenue - u.expense) }));

    // 프로젝트별 비용 (+ 프로젝트 연결 예산 승인액·집행액)
    const projectIds = projectRows.map((p) => p.projectId).filter(Boolean) as string[];
    const projects = await this.repo.projectNames(org, projectIds);
    const projectBudget = new Map<string, { approved: bigint; executed: bigint }>();
    for (const l of budgetLines) {
      const pid = l.budget.projectId;
      if (!pid) continue;
      const cur = projectBudget.get(pid) ?? { approved: 0n, executed: 0n };
      cur.approved += minorOf(l.approvedAmount);
      cur.executed += executedByLine.get(l.id) ?? 0n;
      projectBudget.set(pid, cur);
    }
    const byProject = projectRows.map((p) => {
      const b = projectBudget.get(p.projectId!);
      return {
        id: p.projectId,
        name: projects.get(p.projectId!)?.name ?? '(삭제된 프로젝트)',
        key: projects.get(p.projectId!)?.key ?? null,
        cost: money(p._sum.totalAmount),
        count: p._count._all,
        budgetApproved: b ? fromMinor(b.approved) : null,
        budgetExecuted: b ? fromMinor(b.executed) : null,
      };
    });

    const users = await this.repo.userNames(pendingList.map((p) => p.createdById));

    return {
      year: y,
      basis: '승인된 거래, 부가세 포함 합계 기준',
      totals: {
        revenue: fromMinor(revenue),
        expense: fromMinor(expense),
        profit: fromMinor(revenue - expense),
        pendingExpenseCount: pendingCount,
        pendingExpenseAmount: fromMinor(pendingAmount),
      },
      budget: {
        count: budgetAgg._count._all,
        planned: money(budgetAgg._sum.plannedAmount),
        approved: fromMinor(approvedBudget),
        executed: fromMinor(executed),
        remaining: fromMinor(approvedBudget - executed),
        executionRate: rate(executed, approvedBudget),
      },
      monthly: monthly.map((m) => ({ month: m.month, revenue: fromMinor(m.revenue), expense: fromMinor(m.expense) })),
      byBusinessUnit,
      byProject,
      pendingExpenses: pendingList.map((p) => ({
        id: p.id,
        txDate: p.txDate,
        description: p.description,
        counterparty: p.counterparty,
        totalAmount: money(p.totalAmount),
        businessUnit: p.businessUnit,
        createdBy: users.get(p.createdById) ?? null,
      })),
    };
  }
}
