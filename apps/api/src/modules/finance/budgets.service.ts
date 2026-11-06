import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BudgetPeriod, BudgetStatus, EntityType, Prisma } from '@prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  ApproveBudgetDto, BudgetLineOptionsQueryDto, BudgetQueryDto, CreateBudgetDto, ReasonDto, UpdateBudgetDto,
} from './dto/finance.dto';
import { FinanceRepository, fromMinor, minorOf, money, rate, sumMinor } from './finance.repository';

const budgetInclude = {
  department: { select: { id: true, name: true } },
  businessUnit: { select: { id: true, name: true, code: true } },
  lines: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.BudgetInclude;

type BudgetWithLines = Prisma.BudgetGetPayload<{ include: typeof budgetInclude }>;

const EDITABLE: BudgetStatus[] = ['DRAFT'];

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: FinanceRepository,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
  ) {}

  /** 예산 응답 직렬화: 편성/승인/집행/잔액을 항목별·합계로 노출 (금액은 문자열) */
  private serialize(b: BudgetWithLines, executed: Map<string, bigint>, extra: Record<string, unknown> = {}) {
    let totalExecuted = 0n;
    const lines = b.lines.map((l) => {
      const ex = executed.get(l.id) ?? 0n;
      totalExecuted += ex;
      const approved = minorOf(l.approvedAmount);
      return {
        id: l.id,
        category: l.category,
        description: l.description,
        position: l.position,
        plannedAmount: money(l.plannedAmount),
        approvedAmount: money(l.approvedAmount),
        executedAmount: fromMinor(ex),
        remainingAmount: fromMinor(approved - ex),
        executionRate: rate(ex, approved),
      };
    });
    const approvedTotal = minorOf(b.approvedAmount);
    return {
      id: b.id,
      name: b.name,
      fiscalYear: b.fiscalYear,
      period: b.period,
      quarter: b.quarter,
      status: b.status,
      currency: b.currency,
      notes: b.notes,
      departmentId: b.departmentId,
      department: b.department,
      projectId: b.projectId,
      businessUnitId: b.businessUnitId,
      businessUnit: b.businessUnit,
      plannedAmount: money(b.plannedAmount),
      approvedAmount: money(b.approvedAmount),
      executedAmount: fromMinor(totalExecuted),
      remainingAmount: fromMinor(approvedTotal - totalExecuted),
      executionRate: rate(totalExecuted, approvedTotal),
      approvedById: b.approvedById,
      approvedAt: b.approvedAt,
      createdById: b.createdById,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      lines,
      ...extra,
    };
  }

  async list(auth: AuthContext, q: BudgetQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.BudgetWhereInput = {
      organizationId: auth.organizationId,
      deletedAt: null,
      ...(q.fiscalYear ? { fiscalYear: q.fiscalYear } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.period ? { period: q.period } : {}),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.businessUnitId ? { businessUnitId: q.businessUnitId } : {}),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.budget.findMany({
        where,
        skip,
        take,
        orderBy: orderByArg(q, ['createdAt', 'updatedAt', 'name', 'fiscalYear', 'plannedAmount', 'approvedAmount'] as const, 'updatedAt'),
        include: budgetInclude,
      }),
      this.prisma.budget.count({ where }),
    ]);
    const executed = await this.repo.executedByLine(auth.organizationId, items.flatMap((b) => b.lines.map((l) => l.id)));
    const projects = await this.repo.projectNames(auth.organizationId, items.map((b) => b.projectId));
    return paginated(
      items.map((b) => this.serialize(b, executed, { project: b.projectId ? projects.get(b.projectId) ?? null : null })),
      total,
      page,
      pageSize,
    );
  }

  private async find(auth: AuthContext, id: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<BudgetWithLines> {
    const b = await db.budget.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null }, include: budgetInclude });
    if (!b) throw new NotFoundException('예산을 찾을 수 없습니다.');
    return b;
  }

  async get(auth: AuthContext, id: string) {
    const b = await this.find(auth, id);
    const executed = await this.repo.executedByLine(auth.organizationId, b.lines.map((l) => l.id));
    const [projects, users, activity] = await Promise.all([
      this.repo.projectNames(auth.organizationId, [b.projectId]),
      this.repo.userNames([b.createdById, b.approvedById]),
      this.activity.list(auth.organizationId, EntityType.BUDGET, id, 30),
    ]);
    return this.serialize(b, executed, {
      project: b.projectId ? projects.get(b.projectId) ?? null : null,
      createdBy: users.get(b.createdById) ?? null,
      approvedBy: b.approvedById ? users.get(b.approvedById) ?? null : null,
      activity,
    });
  }

  private validatePeriod(period: BudgetPeriod, quarter: number | null | undefined) {
    if (period === 'QUARTERLY' && !quarter) throw new BadRequestException('분기 예산은 분기(1~4)를 지정해야 합니다.');
    return period === 'QUARTERLY' ? quarter! : null;
  }

  private lineData(lines: CreateBudgetDto['lines']) {
    for (const l of lines) if (minorOf(l.plannedAmount) < 0n) throw new BadRequestException('편성 금액은 0 이상이어야 합니다.');
    return lines.map((l, i) => ({ category: l.category, description: l.description ?? null, plannedAmount: l.plannedAmount, position: i }));
  }

  async create(auth: AuthContext, dto: CreateBudgetDto) {
    const period = dto.period ?? 'ANNUAL';
    const quarter = this.validatePeriod(period, dto.quarter);
    await this.repo.assertRefs(auth, dto);
    const lines = this.lineData(dto.lines);
    const planned = fromMinor(sumMinor(lines.map((l) => l.plannedAmount)));
    return this.prisma.$transaction(async (tx) => {
      const b = await tx.budget.create({
        data: {
          organizationId: auth.organizationId,
          name: dto.name,
          fiscalYear: dto.fiscalYear,
          period,
          quarter,
          departmentId: dto.departmentId ?? null,
          projectId: dto.projectId ?? null,
          businessUnitId: dto.businessUnitId ?? null,
          notes: dto.notes ?? null,
          plannedAmount: planned,
          createdById: auth.userId,
          lines: { create: lines },
        },
      });
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.BUDGET, entityId: b.id, action: 'budget.created', actorId: auth.userId, changes: { name: b.name, plannedAmount: planned } }, tx);
      await this.audit.forUser(auth, 'finance.budget.created', { entityType: 'budget', entityId: b.id, metadata: { plannedAmount: planned } }, tx);
      return this.serialize(await this.find(auth, b.id, tx), new Map());
    });
  }

  async update(auth: AuthContext, id: string, dto: UpdateBudgetDto) {
    const before = await this.find(auth, id);
    if (!EDITABLE.includes(before.status)) throw new ConflictException('작성 중(DRAFT)인 예산만 수정할 수 있습니다.');
    const period = dto.period ?? before.period;
    const quarter = this.validatePeriod(period, dto.quarter === undefined ? before.quarter : dto.quarter);
    await this.repo.assertRefs(auth, dto);
    const lines = dto.lines ? this.lineData(dto.lines) : null;
    const data: Prisma.BudgetUncheckedUpdateInput = {
      name: dto.name,
      fiscalYear: dto.fiscalYear,
      period,
      quarter,
      departmentId: dto.departmentId,
      projectId: dto.projectId,
      businessUnitId: dto.businessUnitId,
      notes: dto.notes,
      ...(lines ? { plannedAmount: fromMinor(sumMinor(lines.map((l) => l.plannedAmount))) } : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      // 상태 경합 방지: DRAFT 인 경우에만 갱신
      const res = await tx.budget.updateMany({ where: { id, organizationId: auth.organizationId, status: 'DRAFT', deletedAt: null }, data });
      if (res.count === 0) throw new ConflictException('예산 상태가 변경되어 수정할 수 없습니다.');
      if (lines) {
        // DRAFT 예산에는 배분(집행)이 존재할 수 없으므로 항목을 교체한다
        await tx.budgetLine.deleteMany({ where: { budgetId: id } });
        await tx.budgetLine.createMany({ data: lines.map((l) => ({ ...l, budgetId: id })) });
      }
      const changes = ActivityService.diff(
        { ...before, plannedAmount: money(before.plannedAmount) } as unknown as Record<string, unknown>,
        { ...data, plannedAmount: data.plannedAmount } as Record<string, unknown>,
      );
      if (Object.keys(changes).length || lines) {
        await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.BUDGET, entityId: id, action: 'budget.updated', actorId: auth.userId, changes }, tx);
      }
      return this.serialize(await this.find(auth, id, tx), new Map());
    });
  }

  async remove(auth: AuthContext, id: string) {
    const b = await this.find(auth, id);
    const allocations = await this.prisma.transactionAllocation.count({ where: { budgetLine: { budgetId: id }, transaction: { deletedAt: null } } });
    if (allocations > 0) throw new ConflictException('집행 내역이 연결된 예산은 삭제할 수 없습니다. 마감(CLOSED) 처리하세요.');
    await this.prisma.$transaction(async (tx) => {
      await tx.budget.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.BUDGET, entityId: id, action: 'budget.deleted', actorId: auth.userId }, tx);
      await this.audit.forUser(auth, 'finance.budget.deleted', { entityType: 'budget', entityId: id, metadata: { name: b.name, status: b.status } }, tx);
    });
    return { ok: true };
  }

  /** 상태 전이 공통: 기대 상태에서만 갱신 (동시 처리 시 409) */
  private async transition(
    auth: AuthContext,
    id: string,
    from: BudgetStatus[],
    data: Prisma.BudgetUncheckedUpdateManyInput,
    action: string,
    tx: Prisma.TransactionClient,
    meta: Record<string, unknown> = {},
  ) {
    const res = await tx.budget.updateMany({ where: { id, organizationId: auth.organizationId, deletedAt: null, status: { in: from } }, data });
    if (res.count === 0) throw new ConflictException('예산 상태가 변경되었거나 이 작업을 수행할 수 없는 상태입니다.');
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.BUDGET, entityId: id, action, actorId: auth.userId, changes: meta }, tx);
  }

  async submit(auth: AuthContext, id: string) {
    const b = await this.find(auth, id);
    if (b.lines.length === 0) throw new BadRequestException('예산 항목을 1개 이상 입력하세요.');
    return this.prisma.$transaction(async (tx) => {
      await this.transition(auth, id, ['DRAFT'], { status: 'PENDING_APPROVAL' }, 'budget.submitted', tx);
      return this.serialize(await this.find(auth, id, tx), new Map());
    });
  }

  /** 예산 승인: 항목별 승인 금액 확정 (편성 금액과 별도 기록). finance.approve 필요 */
  async approve(auth: AuthContext, id: string, dto: ApproveBudgetDto) {
    const b = await this.find(auth, id);
    if (b.lines.length === 0) throw new BadRequestException('예산 항목이 없습니다.');
    const overrides = new Map((dto.lines ?? []).map((l) => [l.lineId, l.approvedAmount]));
    for (const lineId of overrides.keys()) {
      if (!b.lines.some((l) => l.id === lineId)) throw new BadRequestException('예산에 속하지 않은 항목입니다.');
    }
    const approvedLines = b.lines.map((l) => {
      const amount = overrides.get(l.id) ?? money(l.plannedAmount);
      if (minorOf(amount) < 0n) throw new BadRequestException('승인 금액은 0 이상이어야 합니다.');
      return { id: l.id, amount };
    });
    const total = fromMinor(sumMinor(approvedLines.map((l) => l.amount)));
    return this.prisma.$transaction(async (tx) => {
      await this.transition(
        auth, id, ['DRAFT', 'PENDING_APPROVAL'],
        { status: 'APPROVED', approvedAmount: total, approvedById: auth.userId, approvedAt: new Date() },
        'budget.approved', tx, { approvedAmount: total, comment: dto.comment },
      );
      for (const l of approvedLines) await tx.budgetLine.update({ where: { id: l.id }, data: { approvedAmount: l.amount } });
      await this.audit.forUser(auth, 'finance.budget.approved', { entityType: 'budget', entityId: id, metadata: { approvedAmount: total, plannedAmount: money(b.plannedAmount) } }, tx);
      return this.serialize(await this.find(auth, id, tx), await this.repo.executedByLine(auth.organizationId, b.lines.map((l) => l.id), tx));
    });
  }

  /** 승인 대기 예산 반려 → 작성 중(DRAFT)으로 되돌림 */
  async returnToDraft(auth: AuthContext, id: string, dto: ReasonDto) {
    await this.find(auth, id);
    return this.prisma.$transaction(async (tx) => {
      await this.transition(auth, id, ['PENDING_APPROVAL'], { status: 'DRAFT' }, 'budget.returned', tx, { reason: dto.reason });
      await this.audit.forUser(auth, 'finance.budget.returned', { entityType: 'budget', entityId: id, metadata: { reason: dto.reason } }, tx);
      return this.serialize(await this.find(auth, id, tx), new Map());
    });
  }

  async close(auth: AuthContext, id: string) {
    const b = await this.find(auth, id);
    return this.prisma.$transaction(async (tx) => {
      await this.transition(auth, id, ['APPROVED'], { status: 'CLOSED' }, 'budget.closed', tx);
      await this.audit.forUser(auth, 'finance.budget.closed', { entityType: 'budget', entityId: id }, tx);
      return this.serialize(await this.find(auth, id, tx), await this.repo.executedByLine(auth.organizationId, b.lines.map((l) => l.id), tx));
    });
  }

  /**
   * 전자결재(예산 승인 결재) 최종 승인 시 호출: 편성 금액 그대로 승인 처리.
   * 결재 트랜잭션 내부에서 실행된다.
   */
  async approveFromApproval(tx: Prisma.TransactionClient, organizationId: string, budgetId: string, approverId: string, approvalId: string) {
    const b = await tx.budget.findFirst({ where: { id: budgetId, organizationId, deletedAt: null }, include: { lines: true } });
    if (!b || !['DRAFT', 'PENDING_APPROVAL'].includes(b.status)) return false;
    const res = await tx.budget.updateMany({
      where: { id: budgetId, organizationId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } },
      data: { status: 'APPROVED', approvedAmount: b.plannedAmount, approvedById: approverId, approvedAt: new Date() },
    });
    if (res.count === 0) return false;
    for (const l of b.lines) await tx.budgetLine.update({ where: { id: l.id }, data: { approvedAmount: l.plannedAmount } });
    await this.activity.record({ organizationId, entityType: EntityType.BUDGET, entityId: budgetId, action: 'budget.approved', actorId: approverId, changes: { approvedAmount: money(b.plannedAmount), approvalId } }, tx);
    await this.audit.log({ action: 'finance.budget.approved', organizationId, actorId: approverId, entityType: 'budget', entityId: budgetId, metadata: { via: 'approval', approvalId } }, tx);
    return true;
  }

  /** 결재 상태에 맞춰 연결 예산 상태 동기화 (상신 → PENDING_APPROVAL, 반려/보완/취소 → DRAFT) */
  async syncFromApproval(tx: Prisma.TransactionClient, organizationId: string, budgetId: string, to: 'PENDING_APPROVAL' | 'DRAFT') {
    await tx.budget.updateMany({
      where: { id: budgetId, organizationId, deletedAt: null, status: to === 'PENDING_APPROVAL' ? 'DRAFT' : 'PENDING_APPROVAL' },
      data: { status: to },
    });
  }

  /** 거래 배분용: 승인된 예산의 항목 목록 + 잔액 */
  async lineOptions(auth: AuthContext, q: BudgetLineOptionsQueryDto) {
    const lines = await this.prisma.budgetLine.findMany({
      where: {
        budget: {
          organizationId: auth.organizationId,
          deletedAt: null,
          status: 'APPROVED',
          ...(q.fiscalYear ? { fiscalYear: q.fiscalYear } : {}),
        },
        ...(q.q ? { OR: [{ category: { contains: q.q, mode: 'insensitive' } }, { budget: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
      },
      include: { budget: { select: { id: true, name: true, fiscalYear: true, period: true, quarter: true } } },
      orderBy: [{ budget: { fiscalYear: 'desc' } }, { budget: { name: 'asc' } }, { position: 'asc' }],
      take: 500,
    });
    const executed = await this.repo.executedByLine(auth.organizationId, lines.map((l) => l.id));
    return lines.map((l) => {
      const ex = executed.get(l.id) ?? 0n;
      return {
        id: l.id,
        category: l.category,
        budget: l.budget,
        approvedAmount: money(l.approvedAmount),
        executedAmount: fromMinor(ex),
        remainingAmount: fromMinor(minorOf(l.approvedAmount) - ex),
      };
    });
  }
}
