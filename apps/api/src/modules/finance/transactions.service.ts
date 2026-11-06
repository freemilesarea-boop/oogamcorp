import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityType, Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { calcVat } from '@oogam/shared';
import { ActivityService } from '../../common/activity/activity.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  AllocationDto, CreateTransactionDto, ReasonDto, SetAllocationsDto, TransactionQueryDto, UpdateTransactionDto,
} from './dto/finance.dto';
import { FinanceRepository, fromMinor, minorOf, money, sumMinor } from './finance.repository';

const txInclude = {
  businessUnit: { select: { id: true, name: true, code: true } },
  allocations: {
    include: { budgetLine: { select: { id: true, category: true, budget: { select: { id: true, name: true, fiscalYear: true } } } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.FinancialTransactionInclude;

type TxWithRels = Prisma.FinancialTransactionGetPayload<{ include: typeof txInclude }>;

/** 내용 수정이 가능한 상태 (승인 요청·승인 이후에는 수정 불가) */
const EDITABLE: TransactionStatus[] = ['DRAFT', 'REJECTED'];
/** 배분 수정이 가능한 상태 (승인 이후에는 집행 데이터 보호를 위해 불가) */
const ALLOCATABLE: TransactionStatus[] = ['DRAFT', 'PENDING', 'REJECTED'];

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: FinanceRepository,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
  ) {}

  private serialize<E extends object = Record<never, never>>(t: TxWithRels, extra: E = {} as E) {
    const allocated = sumMinor(t.allocations.map((a) => a.amount));
    return {
      id: t.id,
      txDate: t.txDate,
      type: t.type,
      status: t.status,
      businessUnitId: t.businessUnitId,
      businessUnit: t.businessUnit,
      projectId: t.projectId,
      departmentId: t.departmentId,
      counterparty: t.counterparty,
      description: t.description,
      supplyAmount: money(t.supplyAmount),
      vatAmount: money(t.vatAmount),
      totalAmount: money(t.totalAmount),
      allocatedAmount: fromMinor(allocated),
      unallocatedAmount: fromMinor(minorOf(t.totalAmount) - allocated),
      currency: t.currency,
      evidenceFileId: t.evidenceFileId,
      approvalRequestId: t.approvalRequestId,
      createdById: t.createdById,
      approvedById: t.approvedById,
      approvedAt: t.approvedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      allocations: t.allocations.map((a) => ({
        id: a.id,
        budgetLineId: a.budgetLineId,
        amount: money(a.amount),
        budgetLine: a.budgetLine,
      })),
      ...extra,
    };
  }

  private async decorate(auth: AuthContext, rows: TxWithRels[]) {
    const [projects, depts, users] = await Promise.all([
      this.repo.projectNames(auth.organizationId, rows.map((r) => r.projectId)),
      this.repo.departmentNames(auth.organizationId, rows.map((r) => r.departmentId)),
      this.repo.userNames(rows.flatMap((r) => [r.createdById, r.approvedById])),
    ]);
    return rows.map((t) =>
      this.serialize(t, {
        project: t.projectId ? projects.get(t.projectId) ?? null : null,
        department: t.departmentId ? depts.get(t.departmentId) ?? null : null,
        createdBy: users.get(t.createdById) ?? null,
        approvedBy: t.approvedById ? users.get(t.approvedById) ?? null : null,
        canApprove: auth.permissions.has('finance.approve') && t.createdById !== auth.userId && t.status === 'PENDING',
      }),
    );
  }

  private where(auth: AuthContext, q: TransactionQueryDto): Prisma.FinancialTransactionWhereInput {
    return {
      organizationId: auth.organizationId,
      deletedAt: null,
      ...(q.from || q.to ? { txDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.businessUnitId ? { businessUnitId: q.businessUnitId } : {}),
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.q ? { OR: [{ description: { contains: q.q, mode: 'insensitive' } }, { counterparty: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
  }

  private orderBy(q: TransactionQueryDto) {
    return [orderByArg(q, ['txDate', 'totalAmount', 'supplyAmount', 'createdAt', 'updatedAt'] as const, 'txDate'), { createdAt: 'desc' as const }];
  }

  async list(auth: AuthContext, q: TransactionQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = this.where(auth, q);
    const [items, total, sums] = await this.prisma.$transaction([
      this.prisma.financialTransaction.findMany({ where, skip, take, orderBy: this.orderBy(q), include: txInclude }),
      this.prisma.financialTransaction.count({ where }),
      this.prisma.financialTransaction.groupBy({ by: ['type'], where, _sum: { totalAmount: true }, orderBy: { type: 'asc' } }),
    ]);
    const summary = { revenue: '0.00', expense: '0.00' };
    for (const s of sums) summary[s.type === 'REVENUE' ? 'revenue' : 'expense'] = money(s._sum?.totalAmount);
    return { ...paginated(await this.decorate(auth, items), total, page, pageSize), summary };
  }

  private async find(auth: AuthContext, id: string, db: Db = this.prisma) {
    const t = await db.financialTransaction.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null }, include: txInclude });
    if (!t) throw new NotFoundException('거래를 찾을 수 없습니다.');
    return t;
  }

  async get(auth: AuthContext, id: string) {
    const t = await this.find(auth, id);
    const [decorated] = await this.decorate(auth, [t]);
    const [evidence, activity] = await Promise.all([
      t.evidenceFileId
        ? this.prisma.file.findFirst({ where: { id: t.evidenceFileId, organizationId: auth.organizationId, deletedAt: null }, select: { id: true, originalName: true, mimeType: true, size: true } })
        : null,
      this.activity.list(auth.organizationId, EntityType.TRANSACTION, id, 30),
    ]);
    return { ...decorated, evidenceFile: evidence, activity };
  }

  /** 공급가액·부가세·합계 계산 (서버 측, 문자열 Decimal 연산) */
  private amounts(supply: string, vat: string | undefined, autoVat: boolean | undefined) {
    if (minorOf(supply) < 0n) throw new BadRequestException('공급가액은 0 이상이어야 합니다.');
    const v = autoVat ? calcVat(supply, 10) : vat ?? '0';
    if (minorOf(v) < 0n) throw new BadRequestException('부가세는 0 이상이어야 합니다.');
    const total = fromMinor(minorOf(supply) + minorOf(v));
    if (total.replace('-', '').split('.')[0].length > 16) throw new BadRequestException('금액이 너무 큽니다.');
    return { supplyAmount: fromMinor(minorOf(supply)), vatAmount: fromMinor(minorOf(v)), totalAmount: total };
  }

  /**
   * 배분 검증: 지출 거래만, 항목 중복 불가, 금액 > 0, 합계 ≤ 거래 합계,
   * 항목은 같은 조직의 승인(APPROVED)된 예산에 속해야 한다.
   */
  private async validateAllocations(auth: AuthContext, type: TransactionType, total: string, allocations: AllocationDto[], db: Db) {
    if (!allocations.length) return;
    if (type !== 'EXPENSE') throw new BadRequestException('예산 배분은 지출 거래에만 가능합니다.');
    const ids = allocations.map((a) => a.budgetLineId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('같은 예산 항목이 중복되었습니다.');
    for (const a of allocations) if (minorOf(a.amount) <= 0n) throw new BadRequestException('배분 금액은 0보다 커야 합니다.');
    const sum = sumMinor(allocations.map((a) => a.amount));
    if (sum > minorOf(total)) throw new BadRequestException(`배분 합계(${fromMinor(sum)})가 거래 합계(${total})를 초과합니다.`);
    const valid = await db.budgetLine.count({
      where: { id: { in: ids }, budget: { organizationId: auth.organizationId, status: 'APPROVED', deletedAt: null } },
    });
    if (valid !== ids.length) throw new BadRequestException('승인된 예산의 항목에만 배분할 수 있습니다.');
  }

  async create(auth: AuthContext, dto: CreateTransactionDto) {
    await this.repo.assertRefs(auth, dto);
    const amounts = this.amounts(dto.supplyAmount, dto.vatAmount, dto.autoVat);
    const allocations = dto.allocations ?? [];
    return this.prisma.$transaction(async (tx) => {
      await this.validateAllocations(auth, dto.type, amounts.totalAmount, allocations, tx);
      const t = await tx.financialTransaction.create({
        data: {
          organizationId: auth.organizationId,
          txDate: new Date(dto.txDate),
          type: dto.type,
          businessUnitId: dto.businessUnitId ?? null,
          projectId: dto.projectId ?? null,
          departmentId: dto.departmentId ?? null,
          counterparty: dto.counterparty ?? null,
          description: dto.description,
          ...amounts,
          evidenceFileId: dto.evidenceFileId ?? null,
          status: dto.submit ? 'PENDING' : 'DRAFT',
          createdById: auth.userId,
          allocations: { create: allocations.map((a) => ({ budgetLineId: a.budgetLineId, amount: a.amount })) },
        },
      });
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.TRANSACTION, entityId: t.id, action: 'transaction.created', actorId: auth.userId, changes: { type: t.type, totalAmount: amounts.totalAmount } }, tx);
      await this.audit.forUser(auth, 'finance.transaction.created', { entityType: 'transaction', entityId: t.id, metadata: { type: t.type, totalAmount: amounts.totalAmount } }, tx);
      return this.serialize(await this.find(auth, t.id, tx));
    });
  }

  async update(auth: AuthContext, id: string, dto: UpdateTransactionDto) {
    const before = await this.find(auth, id);
    if (!EDITABLE.includes(before.status)) throw new ConflictException('작성 중이거나 반려된 거래만 수정할 수 있습니다.');
    await this.repo.assertRefs(auth, dto);
    const type = dto.type ?? before.type;
    const recompute = dto.supplyAmount !== undefined || dto.vatAmount !== undefined || dto.autoVat;
    const amounts = recompute
      ? this.amounts(dto.supplyAmount ?? money(before.supplyAmount), dto.vatAmount ?? money(before.vatAmount), dto.autoVat)
      : { supplyAmount: money(before.supplyAmount), vatAmount: money(before.vatAmount), totalAmount: money(before.totalAmount) };
    const allocations = dto.allocations ?? before.allocations.map((a) => ({ budgetLineId: a.budgetLineId, amount: money(a.amount) }));
    const data: Prisma.FinancialTransactionUncheckedUpdateManyInput = {
      txDate: dto.txDate ? new Date(dto.txDate) : undefined,
      type: dto.type,
      businessUnitId: dto.businessUnitId,
      projectId: dto.projectId,
      departmentId: dto.departmentId,
      counterparty: dto.counterparty,
      description: dto.description,
      evidenceFileId: dto.evidenceFileId,
      ...amounts,
      // 반려된 거래를 수정하면 다시 작성 중 상태로
      status: 'DRAFT',
    };
    return this.prisma.$transaction(async (tx) => {
      // 배분은 신규 지정 시 검증하고, 기존 배분이라도 금액 변경으로 합계를 초과하면 거절
      if (dto.allocations) {
        await this.validateAllocations(auth, type, amounts.totalAmount, allocations, tx);
      } else if (allocations.length) {
        if (type !== 'EXPENSE') throw new BadRequestException('예산 배분이 있는 거래는 수입으로 변경할 수 없습니다. 배분을 먼저 삭제하세요.');
        if (sumMinor(allocations.map((a) => a.amount)) > minorOf(amounts.totalAmount)) {
          throw new BadRequestException('기존 배분 합계가 변경된 거래 합계를 초과합니다.');
        }
      }
      const res = await tx.financialTransaction.updateMany({ where: { id, organizationId: auth.organizationId, deletedAt: null, status: { in: EDITABLE } }, data });
      if (res.count === 0) throw new ConflictException('거래 상태가 변경되어 수정할 수 없습니다.');
      if (dto.allocations) {
        await tx.transactionAllocation.deleteMany({ where: { transactionId: id } });
        if (allocations.length) await tx.transactionAllocation.createMany({ data: allocations.map((a) => ({ transactionId: id, budgetLineId: a.budgetLineId, amount: a.amount })) });
      }
      const changes = ActivityService.diff(
        { ...before, supplyAmount: money(before.supplyAmount), vatAmount: money(before.vatAmount), totalAmount: money(before.totalAmount) } as unknown as Record<string, unknown>,
        data as Record<string, unknown>,
      );
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.TRANSACTION, entityId: id, action: 'transaction.updated', actorId: auth.userId, changes }, tx);
      return this.serialize(await this.find(auth, id, tx));
    });
  }

  async setAllocations(auth: AuthContext, id: string, dto: SetAllocationsDto) {
    const t = await this.find(auth, id);
    if (!ALLOCATABLE.includes(t.status)) throw new ConflictException('승인된 거래의 배분은 변경할 수 없습니다.');
    return this.prisma.$transaction(async (tx) => {
      await this.validateAllocations(auth, t.type, money(t.totalAmount), dto.allocations, tx);
      // 상태 재확인 (경합 시 승인 이후 변경 방지)
      const lock = await tx.financialTransaction.updateMany({ where: { id, organizationId: auth.organizationId, deletedAt: null, status: { in: ALLOCATABLE } }, data: { updatedAt: new Date() } });
      if (lock.count === 0) throw new ConflictException('거래 상태가 변경되어 배분을 수정할 수 없습니다.');
      await tx.transactionAllocation.deleteMany({ where: { transactionId: id } });
      if (dto.allocations.length) {
        await tx.transactionAllocation.createMany({ data: dto.allocations.map((a) => ({ transactionId: id, budgetLineId: a.budgetLineId, amount: a.amount })) });
      }
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.TRANSACTION, entityId: id, action: 'transaction.allocations.updated', actorId: auth.userId, changes: { allocations: dto.allocations } }, tx);
      return this.serialize(await this.find(auth, id, tx));
    });
  }

  async submit(auth: AuthContext, id: string) {
    await this.find(auth, id);
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.financialTransaction.updateMany({ where: { id, organizationId: auth.organizationId, deletedAt: null, status: { in: EDITABLE } }, data: { status: 'PENDING' } });
      if (res.count === 0) throw new ConflictException('작성 중이거나 반려된 거래만 승인 요청할 수 있습니다.');
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.TRANSACTION, entityId: id, action: 'transaction.submitted', actorId: auth.userId }, tx);
      return this.serialize(await this.find(auth, id, tx));
    });
  }

  /** 직무 분리: 등록자는 본인 거래를 승인/반려할 수 없다 */
  private assertNotCreator(auth: AuthContext, t: { createdById: string }) {
    if (t.createdById === auth.userId) throw new ForbiddenException('본인이 등록한 거래는 승인·반려할 수 없습니다. (직무 분리)');
  }

  async approve(auth: AuthContext, id: string) {
    const t = await this.find(auth, id);
    this.assertNotCreator(auth, t);
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.financialTransaction.updateMany({
        where: { id, organizationId: auth.organizationId, deletedAt: null, status: 'PENDING' },
        data: { status: 'APPROVED', approvedById: auth.userId, approvedAt: new Date() },
      });
      if (res.count === 0) throw new ConflictException('승인 대기(PENDING) 상태의 거래만 승인할 수 있습니다.');
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.TRANSACTION, entityId: id, action: 'transaction.approved', actorId: auth.userId }, tx);
      await this.audit.forUser(auth, 'finance.transaction.approved', { entityType: 'transaction', entityId: id, metadata: { totalAmount: money(t.totalAmount), type: t.type } }, tx);
      return this.serialize(await this.find(auth, id, tx));
    });
  }

  async reject(auth: AuthContext, id: string, dto: ReasonDto) {
    const t = await this.find(auth, id);
    this.assertNotCreator(auth, t);
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.financialTransaction.updateMany({
        where: { id, organizationId: auth.organizationId, deletedAt: null, status: 'PENDING' },
        data: { status: 'REJECTED', approvedById: null, approvedAt: null },
      });
      if (res.count === 0) throw new ConflictException('승인 대기(PENDING) 상태의 거래만 반려할 수 있습니다.');
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.TRANSACTION, entityId: id, action: 'transaction.rejected', actorId: auth.userId, changes: { reason: dto.reason } }, tx);
      await this.audit.forUser(auth, 'finance.transaction.rejected', { entityType: 'transaction', entityId: id, metadata: { reason: dto.reason } }, tx);
      return this.serialize(await this.find(auth, id, tx));
    });
  }

  async remove(auth: AuthContext, id: string) {
    const t = await this.find(auth, id);
    if (t.status === 'APPROVED' && !auth.permissions.has('finance.approve')) {
      throw new ForbiddenException('승인된 거래는 승인 권한자만 삭제할 수 있습니다.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.financialTransaction.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.TRANSACTION, entityId: id, action: 'transaction.deleted', actorId: auth.userId }, tx);
      await this.audit.forUser(auth, 'finance.transaction.deleted', { entityType: 'transaction', entityId: id, metadata: { status: t.status, totalAmount: money(t.totalAmount) } }, tx);
    });
    return { ok: true };
  }

  /** CSV 내보내기 (최대 10,000건). 스프레드시트 수식 주입 방지 처리 */
  async exportCsv(auth: AuthContext, q: TransactionQueryDto): Promise<string> {
    const rows = await this.prisma.financialTransaction.findMany({ where: this.where(auth, q), orderBy: this.orderBy(q), include: txInclude, take: 10_000 });
    const decorated = await this.decorate(auth, rows);
    const esc = (v: unknown) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const TYPE = { REVENUE: '수입', EXPENSE: '지출' } as const;
    const STATUS = { DRAFT: '작성 중', PENDING: '승인 대기', APPROVED: '승인', REJECTED: '반려' } as const;
    const header = ['거래일', '구분', '상태', '사업 구분', '프로젝트', '부서', '거래처', '적요', '공급가액', '부가세', '합계', '등록자', '승인자'];
    const lines = decorated.map((t) => [
      t.txDate.toISOString().slice(0, 10), TYPE[t.type], STATUS[t.status], t.businessUnit?.name, t.project?.name,
      t.department?.name, t.counterparty, t.description, t.supplyAmount, t.vatAmount, t.totalAmount,
      t.createdBy?.name, t.approvedBy?.name,
    ].map(esc).join(','));
    await this.audit.forUser(auth, 'finance.transaction.exported', { metadata: { count: rows.length } });
    return '﻿' + [header.join(','), ...lines].join('\r\n');
  }

  /**
   * 전자결재(지출 결의) 최종 승인 시 호출: 연결 거래를 APPROVED 로 전환.
   * 직무 분리 — 최종 승인자가 거래 등록자이면 거절한다.
   */
  async approveFromApproval(tx: Prisma.TransactionClient, organizationId: string, transactionId: string, approverId: string, approvalId: string) {
    const t = await tx.financialTransaction.findFirst({ where: { id: transactionId, organizationId, deletedAt: null } });
    if (!t || t.status === 'APPROVED') return false;
    if (t.createdById === approverId) throw new ForbiddenException('본인이 등록한 거래는 최종 승인할 수 없습니다. (직무 분리)');
    const res = await tx.financialTransaction.updateMany({
      where: { id: transactionId, organizationId, deletedAt: null, status: { in: ['DRAFT', 'PENDING', 'REJECTED'] } },
      data: { status: 'APPROVED', approvedById: approverId, approvedAt: new Date(), approvalRequestId: approvalId },
    });
    if (res.count === 0) return false;
    await this.activity.record({ organizationId, entityType: EntityType.TRANSACTION, entityId: transactionId, action: 'transaction.approved', actorId: approverId, changes: { approvalId } }, tx);
    await this.audit.log({ action: 'finance.transaction.approved', organizationId, actorId: approverId, entityType: 'transaction', entityId: transactionId, metadata: { via: 'approval', approvalId } }, tx);
    return true;
  }

  /** 결재 상태에 맞춰 연결 거래 상태 동기화 (상신 → PENDING, 반려 → REJECTED, 보완 요청/취소 → DRAFT) */
  async syncFromApproval(tx: Prisma.TransactionClient, organizationId: string, transactionId: string, approvalId: string, to: 'PENDING' | 'REJECTED' | 'DRAFT') {
    const from: TransactionStatus[] = to === 'PENDING' ? ['DRAFT', 'REJECTED'] : ['PENDING'];
    await tx.financialTransaction.updateMany({
      where: { id: transactionId, organizationId, deletedAt: null, status: { in: from } },
      data: { status: to, approvalRequestId: approvalId },
    });
  }
}
