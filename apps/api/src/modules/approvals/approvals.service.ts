import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ApprovalActionType, ApprovalStatus, ApprovalStepStatus, Prisma } from '@prisma/client';
import { APPROVAL_TYPE_LABELS } from '@oogam/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { NotifyService } from '../../common/notify/notify.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntityAccessService } from '../access/entity-access.service';
import { BudgetsService } from '../finance/budgets.service';
import { TransactionsService } from '../finance/transactions.service';
import { ApprovalsRepository, detailInclude, type ApprovalWithSteps } from './approvals.repository';
import {
  ApprovalActionDto, ApprovalCommentDto, ApprovalQueryDto, CreateApprovalDto, RequiredCommentActionDto, UpdateApprovalDto,
} from './dto/approval.dto';

type Tx = Prisma.TransactionClient;
type ActKind = 'approve' | 'reject' | 'request_changes';

const EDITABLE: ApprovalStatus[] = ['DRAFT', 'CHANGES_REQUESTED'];
const CANCELLABLE: ApprovalStatus[] = ['DRAFT', 'PENDING', 'CHANGES_REQUESTED'];
const DELETABLE: ApprovalStatus[] = ['DRAFT', 'CANCELLED'];
const MAX_NUMBER_RETRIES = 8;

const link = (id: string) => `/admin/approvals?id=${id}`;

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ApprovalsRepository,
    private readonly entityAccess: EntityAccessService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
    private readonly budgets: BudgetsService,
    private readonly transactions: TransactionsService,
  ) {}

  // ───────────────────────── 조회 ─────────────────────────

  /** 금액·재무 연결 정보 열람 가능 여부: 기안자/결재자 또는 finance.read */
  private canSeeFinance(auth: AuthContext, req: { requesterId: string; steps: { approverId: string }[] }) {
    return req.requesterId === auth.userId || req.steps.some((s) => s.approverId === auth.userId) || auth.permissions.has('finance.read');
  }

  private boxWhere(auth: AuthContext, box: ApprovalQueryDto['box']): Prisma.ApprovalRequestWhereInput {
    const me = auth.userId;
    switch (box) {
      case 'mine':
        return { requesterId: me };
      case 'todo':
        return { status: 'PENDING', steps: { some: { approverId: me, status: 'PENDING' } } };
      case 'done':
        return { steps: { some: { approverId: me, status: { in: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] } } } };
      case 'all':
        if (!auth.permissions.has('approvals.read_all')) throw new ForbiddenException('전체 결재 문서 열람 권한이 없습니다.');
        // 타인의 임시저장 문서는 제외
        return { OR: [{ requesterId: me }, { status: { not: 'DRAFT' } }] };
      default:
        return { OR: [{ requesterId: me }, { status: { not: 'DRAFT' }, steps: { some: { approverId: me } } }] };
    }
  }

  async list(auth: AuthContext, q: ApprovalQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.ApprovalRequestWhereInput = {
      AND: [
        { organizationId: auth.organizationId, deletedAt: null },
        this.boxWhere(auth, q.box),
        q.status ? { status: q.status } : {},
        q.type ? { type: q.type } : {},
        q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { number: { contains: q.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.approvalRequest.findMany({
        where,
        skip,
        take,
        orderBy: [orderByArg(q, ['createdAt', 'updatedAt', 'submittedAt', 'completedAt', 'number', 'title'] as const, 'updatedAt'), { id: 'asc' }],
        include: { steps: { orderBy: { order: 'asc' }, include: { approver: { select: { id: true, name: true, email: true, avatarUrl: true } } } } },
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    const users = await this.repo.users(items.map((i) => i.requesterId));
    return paginated(
      items.map((r) => {
        const current = r.steps.find((s) => s.status === 'PENDING') ?? null;
        return {
          id: r.id,
          number: r.number,
          type: r.type,
          title: r.title,
          status: r.status,
          amount: this.canSeeFinance(auth, r) && r.amount ? r.amount.toFixed(2) : null,
          requester: users.get(r.requesterId) ?? null,
          currentStepOrder: r.currentStepOrder,
          currentApprover: current?.approver ?? null,
          stepCount: r.steps.length,
          steps: r.steps.map((s) => ({ order: s.order, status: s.status, approver: s.approver })),
          isMyTurn: !!current && current.approverId === auth.userId && r.status === 'PENDING',
          submittedAt: r.submittedAt,
          completedAt: r.completedAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      }),
      total,
      page,
      pageSize,
    );
  }

  async summary(auth: AuthContext) {
    const base = { organizationId: auth.organizationId, deletedAt: null };
    const [todo, minePending, changesRequested, drafts] = await Promise.all([
      this.prisma.approvalRequest.count({ where: { ...base, status: 'PENDING', steps: { some: { approverId: auth.userId, status: 'PENDING' } } } }),
      this.prisma.approvalRequest.count({ where: { ...base, requesterId: auth.userId, status: 'PENDING' } }),
      this.prisma.approvalRequest.count({ where: { ...base, requesterId: auth.userId, status: 'CHANGES_REQUESTED' } }),
      this.prisma.approvalRequest.count({ where: { ...base, requesterId: auth.userId, status: 'DRAFT' } }),
    ]);
    return { todo, minePending, changesRequested, drafts };
  }

  /** 접근 확인 후 문서 로드. 접근 불가/타인의 임시저장은 404 (존재 여부 노출 방지) */
  private async loadVisible(auth: AuthContext, id: string, db: Tx | PrismaService = this.prisma): Promise<ApprovalWithSteps> {
    if (!(await this.entityAccess.can(auth, 'APPROVAL', id, 'view'))) throw new NotFoundException('결재 문서를 찾을 수 없습니다.');
    const req = await this.repo.find(auth.organizationId, id, db);
    if (!req || (req.status === 'DRAFT' && req.requesterId !== auth.userId)) throw new NotFoundException('결재 문서를 찾을 수 없습니다.');
    return req;
  }

  async get(auth: AuthContext, id: string) {
    await this.loadVisible(auth, id);
    const req = await this.prisma.approvalRequest.findFirstOrThrow({ where: { id, organizationId: auth.organizationId }, include: detailInclude });
    const seeFinance = this.canSeeFinance(auth, req);
    const users = await this.repo.users([req.requesterId, ...req.actions.map((a) => a.actorId)]);
    const [attachments, project, budget, transaction] = await Promise.all([
      this.prisma.file.findMany({
        where: { organizationId: auth.organizationId, targetType: 'APPROVAL', targetId: id, deletedAt: null },
        select: { id: true, originalName: true, mimeType: true, size: true, uploadedById: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      req.projectId && (await this.entityAccess.can(auth, 'PROJECT', req.projectId))
        ? this.prisma.project.findFirst({ where: { id: req.projectId, organizationId: auth.organizationId }, select: { id: true, key: true, name: true } })
        : null,
      req.budgetId && seeFinance
        ? this.prisma.budget.findFirst({
          where: { id: req.budgetId, organizationId: auth.organizationId },
          select: { id: true, name: true, fiscalYear: true, status: true, plannedAmount: true, approvedAmount: true },
        })
        : null,
      req.transactionId && seeFinance
        ? this.prisma.financialTransaction.findFirst({
          where: { id: req.transactionId, organizationId: auth.organizationId },
          select: { id: true, txDate: true, type: true, description: true, counterparty: true, totalAmount: true, status: true },
        })
        : null,
    ]);
    const current = req.steps.find((s) => s.status === 'PENDING' && s.order === req.currentStepOrder) ?? null;
    const isRequester = req.requesterId === auth.userId;
    return {
      id: req.id,
      number: req.number,
      type: req.type,
      title: req.title,
      content: req.content,
      status: req.status,
      version: req.version,
      amount: seeFinance && req.amount ? req.amount.toFixed(2) : null,
      requester: users.get(req.requesterId) ?? null,
      currentStepOrder: req.currentStepOrder,
      submittedAt: req.submittedAt,
      completedAt: req.completedAt,
      createdAt: req.createdAt,
      updatedAt: req.updatedAt,
      projectId: req.projectId,
      budgetId: seeFinance ? req.budgetId : null,
      transactionId: seeFinance ? req.transactionId : null,
      project,
      budget: budget ? { ...budget, plannedAmount: budget.plannedAmount.toFixed(2), approvedAmount: budget.approvedAmount.toFixed(2) } : null,
      transaction: transaction ? { ...transaction, totalAmount: transaction.totalAmount.toFixed(2) } : null,
      steps: req.steps.map((s) => ({ id: s.id, order: s.order, status: s.status, actedAt: s.actedAt, approver: s.approver })),
      actions: req.actions.map((a) => ({ id: a.id, action: a.action, comment: a.comment, stepId: a.stepId, createdAt: a.createdAt, actor: users.get(a.actorId) ?? null })),
      attachments,
      can: {
        approve: req.status === 'PENDING' && current?.approverId === auth.userId,
        edit: isRequester && EDITABLE.includes(req.status),
        submit: isRequester && EDITABLE.includes(req.status),
        cancel: isRequester && CANCELLABLE.includes(req.status),
        delete: isRequester && DELETABLE.includes(req.status),
      },
    };
  }

  // ───────────────────────── 검증 ─────────────────────────

  /** 결재선 검증: 1~10명, 중복 불가, 기안자 제외, 같은 조직의 활성 구성원 */
  private async validateApprovers(auth: AuthContext, approverIds: string[]) {
    if (!approverIds.length || approverIds.length > 10) throw new BadRequestException('결재자는 1~10명이어야 합니다.');
    if (new Set(approverIds).size !== approverIds.length) throw new BadRequestException('결재자가 중복되었습니다.');
    if (approverIds.includes(auth.userId)) throw new BadRequestException('본인을 결재자로 지정할 수 없습니다.');
    const count = await this.prisma.membership.count({
      where: {
        organizationId: auth.organizationId,
        userId: { in: approverIds },
        employmentStatus: { not: 'RESIGNED' },
        user: { status: 'ACTIVE', deletedAt: null },
      },
    });
    if (count !== approverIds.length) throw new BadRequestException('조직의 활성 구성원만 결재자로 지정할 수 있습니다.');
  }

  /**
   * 연결 대상 검증. 예산/거래 연결은 finance.read 필요.
   * 반환: 금액 미입력 시 연결 대상 금액으로 채울 기본값
   */
  private async validateLinks(
    auth: AuthContext,
    links: { type: string; projectId?: string | null; budgetId?: string | null; transactionId?: string | null; approverIds: string[] },
  ): Promise<string | null> {
    let defaultAmount: string | null = null;
    if (links.projectId && !(await this.entityAccess.can(auth, 'PROJECT', links.projectId, 'view'))) {
      throw new BadRequestException('프로젝트를 찾을 수 없거나 접근 권한이 없습니다.');
    }
    if ((links.budgetId || links.transactionId) && !auth.permissions.has('finance.read')) {
      throw new ForbiddenException('예산·거래 연결에는 재무 열람 권한이 필요합니다.');
    }
    if (links.budgetId) {
      const b = await this.prisma.budget.findFirst({ where: { id: links.budgetId, organizationId: auth.organizationId, deletedAt: null } });
      if (!b) throw new BadRequestException('예산을 찾을 수 없습니다.');
      if (links.type === 'BUDGET' && !['DRAFT', 'PENDING_APPROVAL'].includes(b.status)) {
        throw new BadRequestException('작성 중이거나 승인 대기 중인 예산만 예산 승인 결재에 연결할 수 있습니다.');
      }
      if (links.type === 'BUDGET') defaultAmount = b.plannedAmount.toFixed(2);
    }
    if (links.transactionId) {
      const t = await this.prisma.financialTransaction.findFirst({ where: { id: links.transactionId, organizationId: auth.organizationId, deletedAt: null } });
      if (!t) throw new BadRequestException('거래를 찾을 수 없습니다.');
      if (t.status === 'APPROVED') throw new BadRequestException('이미 승인된 거래입니다.');
      if (links.type === 'EXPENSE' && t.type !== 'EXPENSE') throw new BadRequestException('지출 결의에는 지출 거래만 연결할 수 있습니다.');
      // 직무 분리: 거래 등록자는 최종 결재자가 될 수 없다
      if (links.approverIds[links.approverIds.length - 1] === t.createdById) {
        throw new BadRequestException('거래 등록자는 최종 결재자가 될 수 없습니다. (직무 분리)');
      }
      defaultAmount = t.totalAmount.toFixed(2);
    }
    return defaultAmount;
  }

  // ───────────────────────── 작성/수정 ─────────────────────────

  async create(auth: AuthContext, dto: CreateApprovalDto) {
    const type = dto.type ?? 'GENERAL';
    await this.validateApprovers(auth, dto.approverIds);
    const defaultAmount = await this.validateLinks(auth, { ...dto, type });
    const amount = dto.amount ?? defaultAmount;
    if (amount && amount.startsWith('-')) throw new BadRequestException('금액은 0 이상이어야 합니다.');

    // 문서 번호(APR-YYYY-NNNN)는 (organizationId, number) 고유 제약 + 충돌 시 재시도로 동시성 안전 확보
    for (let attempt = 0; ; attempt++) {
      try {
        const id = await this.prisma.$transaction(async (tx) => {
          const number = await this.repo.nextNumber(tx, auth.organizationId);
          const req = await tx.approvalRequest.create({
            data: {
              organizationId: auth.organizationId,
              number,
              type,
              title: dto.title,
              content: dto.content,
              amount,
              requesterId: auth.userId,
              projectId: dto.projectId ?? null,
              budgetId: dto.budgetId ?? null,
              transactionId: dto.transactionId ?? null,
              steps: { create: dto.approverIds.map((approverId, i) => ({ order: i + 1, approverId })) },
            },
          });
          await this.audit.forUser(auth, 'approval.created', { entityType: 'approval', entityId: req.id, metadata: { number, type } }, tx);
          if (dto.submit) await this.doSubmit(tx, auth, req.id, req.version, false);
          return req.id;
        });
        return this.get(auth, id);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < MAX_NUMBER_RETRIES) {
          await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 25)));
          continue;
        }
        throw e;
      }
    }
  }

  async update(auth: AuthContext, id: string, dto: UpdateApprovalDto) {
    const req = await this.loadVisible(auth, id);
    if (req.requesterId !== auth.userId) throw new ForbiddenException('기안자만 수정할 수 있습니다.');
    if (!EDITABLE.includes(req.status)) throw new ConflictException('임시저장 또는 보완 요청 상태에서만 수정할 수 있습니다.');
    const approverIds = dto.approverIds ?? req.steps.map((s) => s.approverId);
    if (dto.approverIds) await this.validateApprovers(auth, dto.approverIds);
    const type = dto.type ?? req.type;
    const merged = {
      type,
      projectId: dto.projectId === undefined ? req.projectId : dto.projectId,
      budgetId: dto.budgetId === undefined ? req.budgetId : dto.budgetId,
      transactionId: dto.transactionId === undefined ? req.transactionId : dto.transactionId,
      approverIds,
    };
    const defaultAmount = await this.validateLinks(auth, merged);
    if (dto.amount && dto.amount.startsWith('-')) throw new BadRequestException('금액은 0 이상이어야 합니다.');
    const expected = dto.version ?? req.version;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.approvalRequest.updateMany({
        where: { id, organizationId: auth.organizationId, version: expected, status: { in: EDITABLE }, deletedAt: null },
        data: {
          type,
          title: dto.title,
          content: dto.content,
          amount: dto.amount === undefined ? (req.amount ? undefined : defaultAmount) : dto.amount,
          projectId: merged.projectId,
          budgetId: merged.budgetId,
          transactionId: merged.transactionId,
          version: { increment: 1 },
        },
      });
      if (res.count === 0) throw new ConflictException('문서가 변경되었습니다. 새로고침 후 다시 시도하세요.');
      if (dto.approverIds) {
        await tx.approvalStep.deleteMany({ where: { requestId: id } });
        await tx.approvalStep.createMany({ data: dto.approverIds.map((approverId, i) => ({ requestId: id, order: i + 1, approverId })) });
      }
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    const req = await this.loadVisible(auth, id);
    if (req.requesterId !== auth.userId) throw new ForbiddenException('기안자만 삭제할 수 있습니다.');
    const res = await this.prisma.approvalRequest.updateMany({
      where: { id, organizationId: auth.organizationId, status: { in: DELETABLE }, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (res.count === 0) throw new ConflictException('임시저장 또는 취소된 문서만 삭제할 수 있습니다.');
    await this.audit.forUser(auth, 'approval.deleted', { entityType: 'approval', entityId: id, metadata: { number: req.number } });
    return { ok: true };
  }

  // ───────────────────────── 결재 처리 ─────────────────────────

  /**
   * 상신/재상신: 결재선을 초기화(1단계 PENDING, 나머지 WAITING)하고 첫 결재자에게 알림.
   * 낙관적 잠금 — 기대 버전·상태가 일치할 때만 전이한다.
   */
  private async doSubmit(tx: Tx, auth: AuthContext, id: string, expectedVersion: number, resubmit: boolean) {
    const res = await tx.approvalRequest.updateMany({
      where: { id, organizationId: auth.organizationId, version: expectedVersion, status: { in: EDITABLE }, deletedAt: null },
      data: { status: 'PENDING', currentStepOrder: 1, submittedAt: new Date(), completedAt: null, version: { increment: 1 } },
    });
    if (res.count === 0) throw new ConflictException('문서가 변경되었거나 상신할 수 없는 상태입니다.');
    const req = await this.repo.find(auth.organizationId, id, tx);
    if (!req || req.steps.length === 0) throw new BadRequestException('결재선이 비어 있습니다.');
    await tx.approvalStep.updateMany({ where: { requestId: id }, data: { status: 'WAITING', actedAt: null } });
    const first = req.steps[0];
    await tx.approvalStep.update({ where: { id: first.id }, data: { status: 'PENDING' } });
    await tx.approvalAction.create({ data: { requestId: id, actorId: auth.userId, action: resubmit ? 'RESUBMIT' : 'SUBMIT' } });
    if (req.transactionId) await this.transactions.syncFromApproval(tx, auth.organizationId, req.transactionId, id, 'PENDING');
    if (req.budgetId && req.type === 'BUDGET') await this.budgets.syncFromApproval(tx, auth.organizationId, req.budgetId, 'PENDING_APPROVAL');
    await this.notify.send({
      organizationId: auth.organizationId,
      userIds: [first.approverId],
      type: 'APPROVAL_REQUESTED',
      title: `[결재 요청] ${req.title}`,
      body: `${auth.name}님이 ${APPROVAL_TYPE_LABELS[req.type]} 문서(${req.number})의 결재를 요청했습니다.`,
      link: link(id),
      entityType: 'APPROVAL',
      entityId: id,
      actorId: auth.userId,
    }, tx);
  }

  async submit(auth: AuthContext, id: string, dto: ApprovalActionDto) {
    const req = await this.loadVisible(auth, id);
    if (req.requesterId !== auth.userId) throw new ForbiddenException('기안자만 상신할 수 있습니다.');
    if (!EDITABLE.includes(req.status)) throw new ConflictException('임시저장 또는 보완 요청 상태에서만 상신할 수 있습니다.');
    // 연결 대상 상태 재검증 (작성 이후 변경되었을 수 있음)
    await this.validateLinks(auth, { type: req.type, projectId: null, budgetId: req.budgetId, transactionId: req.transactionId, approverIds: req.steps.map((s) => s.approverId) });
    const resubmit = req.status === 'CHANGES_REQUESTED';
    await this.prisma.$transaction(async (tx) => {
      await this.doSubmit(tx, auth, id, dto.version ?? req.version, resubmit);
      await this.audit.forUser(auth, resubmit ? 'approval.resubmitted' : 'approval.submitted', { entityType: 'approval', entityId: id }, tx);
    });
    return this.get(auth, id);
  }

  approve(auth: AuthContext, id: string, dto: ApprovalActionDto) {
    return this.act(auth, id, 'approve', dto.version, dto.comment);
  }

  reject(auth: AuthContext, id: string, dto: RequiredCommentActionDto) {
    return this.act(auth, id, 'reject', dto.version, dto.comment);
  }

  requestChanges(auth: AuthContext, id: string, dto: RequiredCommentActionDto) {
    return this.act(auth, id, 'request_changes', dto.version, dto.comment);
  }

  /**
   * 승인/반려/보완 요청. 전체를 하나의 DB 트랜잭션에서 낙관적 잠금으로 처리한다:
   * updateMany where {id, version, status: PENDING, currentStepOrder} → 0건이면 409.
   * 동일 문서에 대한 동시 처리는 정확히 한 건만 성공한다.
   */
  private async act(auth: AuthContext, id: string, kind: ActKind, version: number | undefined, comment: string | undefined) {
    await this.loadVisible(auth, id);
    await this.prisma.$transaction(async (tx) => {
      const req = await this.repo.find(auth.organizationId, id, tx);
      if (!req) throw new NotFoundException('결재 문서를 찾을 수 없습니다.');
      const mine = req.steps.find((s) => s.approverId === auth.userId);
      if (req.status !== 'PENDING') {
        if (mine) throw new ConflictException('이미 처리되었거나 결재 진행 중이 아닌 문서입니다.');
        throw new ForbiddenException('이 문서의 결재자가 아닙니다.');
      }
      const step = req.steps.find((s) => s.order === req.currentStepOrder && s.status === 'PENDING');
      if (!step) throw new ConflictException('결재 단계 정보가 올바르지 않습니다.');
      if (step.approverId !== auth.userId) {
        if (mine && mine.status !== 'WAITING') throw new ConflictException('이미 처리한 결재입니다.');
        throw new ForbiddenException('현재 결재 차례가 아닙니다.');
      }
      if (version !== undefined && version !== req.version) throw new ConflictException('문서가 변경되었습니다. 새로고침 후 다시 시도하세요.');
      const expected = version ?? req.version;

      const next = kind === 'approve' ? req.steps.find((s) => s.order > step.order) : undefined;
      const final = kind === 'approve' && !next;
      const now = new Date();
      const data: Prisma.ApprovalRequestUpdateManyMutationInput & { currentStepOrder?: number | null } =
        kind === 'approve'
          ? next
            ? { currentStepOrder: next.order }
            : { status: 'APPROVED', currentStepOrder: null, completedAt: now }
          : kind === 'reject'
            ? { status: 'REJECTED', currentStepOrder: null, completedAt: now }
            : { status: 'CHANGES_REQUESTED', currentStepOrder: null };

      // 낙관적 잠금: 기대 버전·상태·단계가 모두 일치할 때만 갱신
      const res = await tx.approvalRequest.updateMany({
        where: { id, organizationId: auth.organizationId, version: expected, status: 'PENDING', currentStepOrder: step.order, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
      if (res.count === 0) throw new ConflictException('다른 사용자가 먼저 처리했거나 문서가 변경되었습니다. 새로고침 후 다시 시도하세요.');

      const stepStatus: ApprovalStepStatus = kind === 'approve' ? 'APPROVED' : kind === 'reject' ? 'REJECTED' : 'CHANGES_REQUESTED';
      const stepRes = await tx.approvalStep.updateMany({ where: { id: step.id, status: 'PENDING' }, data: { status: stepStatus, actedAt: now } });
      if (stepRes.count === 0) throw new ConflictException('이미 처리된 결재 단계입니다.');
      if (next) await tx.approvalStep.update({ where: { id: next.id }, data: { status: 'PENDING' } });
      if (kind === 'reject') {
        await tx.approvalStep.updateMany({ where: { requestId: id, status: 'WAITING' }, data: { status: 'SKIPPED' } });
      }
      const actionType: ApprovalActionType = kind === 'approve' ? 'APPROVE' : kind === 'reject' ? 'REJECT' : 'REQUEST_CHANGES';
      await tx.approvalAction.create({ data: { requestId: id, stepId: step.id, actorId: auth.userId, action: actionType, comment: comment || null } });

      // 연동 처리
      if (final) {
        if (req.type === 'EXPENSE' && req.transactionId) {
          await this.transactions.approveFromApproval(tx, auth.organizationId, req.transactionId, auth.userId, id);
        }
        if (req.type === 'BUDGET' && req.budgetId) {
          await this.budgets.approveFromApproval(tx, auth.organizationId, req.budgetId, auth.userId, id);
        }
      } else if (kind !== 'approve') {
        if (req.transactionId) {
          await this.transactions.syncFromApproval(tx, auth.organizationId, req.transactionId, id, kind === 'reject' ? 'REJECTED' : 'DRAFT');
        }
        if (req.budgetId && req.type === 'BUDGET') await this.budgets.syncFromApproval(tx, auth.organizationId, req.budgetId, 'DRAFT');
      }

      // 알림
      if (next) {
        await this.notify.send({
          organizationId: auth.organizationId, userIds: [next.approverId], type: 'APPROVAL_REQUESTED',
          title: `[결재 요청] ${req.title}`, body: `${req.number} 문서가 결재 대기 중입니다.`,
          link: link(id), entityType: 'APPROVAL', entityId: id, actorId: auth.userId,
        }, tx);
      } else if (kind === 'request_changes') {
        await this.notify.send({
          organizationId: auth.organizationId, userIds: [req.requesterId], type: 'APPROVAL_CHANGES_REQUESTED',
          title: `[보완 요청] ${req.title}`, body: `${auth.name}: ${comment ?? ''}`,
          link: link(id), entityType: 'APPROVAL', entityId: id, actorId: auth.userId,
        }, tx);
      } else {
        await this.notify.send({
          organizationId: auth.organizationId, userIds: [req.requesterId], type: 'APPROVAL_COMPLETED',
          title: kind === 'approve' ? `[승인 완료] ${req.title}` : `[반려] ${req.title}`,
          body: kind === 'approve' ? `${req.number} 문서가 최종 승인되었습니다.` : `${auth.name}: ${comment ?? ''}`,
          link: link(id), entityType: 'APPROVAL', entityId: id, actorId: auth.userId,
        }, tx);
      }

      await this.audit.forUser(auth, `approval.${kind === 'approve' ? (final ? 'approved' : 'step_approved') : kind === 'reject' ? 'rejected' : 'changes_requested'}`, {
        entityType: 'approval', entityId: id, metadata: { number: req.number, step: step.order },
      }, tx);
    });
    return this.get(auth, id);
  }

  async cancel(auth: AuthContext, id: string, dto: ApprovalActionDto) {
    const req = await this.loadVisible(auth, id);
    if (req.requesterId !== auth.userId) throw new ForbiddenException('기안자만 취소할 수 있습니다.');
    if (!CANCELLABLE.includes(req.status)) throw new ConflictException('완료된 문서는 취소할 수 없습니다.');
    const current = req.steps.find((s) => s.status === 'PENDING');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.approvalRequest.updateMany({
        where: { id, organizationId: auth.organizationId, version: dto.version ?? req.version, status: { in: CANCELLABLE }, deletedAt: null },
        data: { status: 'CANCELLED', currentStepOrder: null, completedAt: new Date(), version: { increment: 1 } },
      });
      if (res.count === 0) throw new ConflictException('문서가 변경되었습니다. 새로고침 후 다시 시도하세요.');
      await tx.approvalStep.updateMany({ where: { requestId: id, status: { in: ['PENDING', 'WAITING'] } }, data: { status: 'SKIPPED' } });
      await tx.approvalAction.create({ data: { requestId: id, actorId: auth.userId, action: 'CANCEL', comment: dto.comment || null } });
      if (req.transactionId) await this.transactions.syncFromApproval(tx, auth.organizationId, req.transactionId, id, 'DRAFT');
      if (req.budgetId && req.type === 'BUDGET') await this.budgets.syncFromApproval(tx, auth.organizationId, req.budgetId, 'DRAFT');
      if (current && req.status === 'PENDING') {
        await this.notify.send({
          organizationId: auth.organizationId, userIds: [current.approverId], type: 'SYSTEM',
          title: `[결재 취소] ${req.title}`, body: `${req.number} 문서가 기안자에 의해 취소되었습니다.`,
          link: link(id), entityType: 'APPROVAL', entityId: id, actorId: auth.userId,
        }, tx);
      }
      await this.audit.forUser(auth, 'approval.cancelled', { entityType: 'approval', entityId: id, metadata: { number: req.number } }, tx);
    });
    return this.get(auth, id);
  }

  /** 결재 의견(이력에 COMMENT 로 기록). 열람 가능한 사용자 */
  async comment(auth: AuthContext, id: string, dto: ApprovalCommentDto) {
    const req = await this.loadVisible(auth, id);
    await this.prisma.approvalAction.create({ data: { requestId: req.id, actorId: auth.userId, action: 'COMMENT', comment: dto.comment } });
    return this.get(auth, id);
  }
}
