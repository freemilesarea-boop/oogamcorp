import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

const approverSelect = { select: { id: true, name: true, email: true, avatarUrl: true } } as const;

export const stepsInclude = {
  steps: { orderBy: { order: 'asc' }, include: { approver: approverSelect } },
} satisfies Prisma.ApprovalRequestInclude;

export const detailInclude = {
  ...stepsInclude,
  actions: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ApprovalRequestInclude;

export type ApprovalWithSteps = Prisma.ApprovalRequestGetPayload<{ include: typeof stepsInclude }>;

/** 전자결재 데이터 접근 계층 */
@Injectable()
export class ApprovalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(organizationId: string, id: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<ApprovalWithSteps | null> {
    return db.approvalRequest.findFirst({ where: { id, organizationId, deletedAt: null }, include: stepsInclude });
  }

  /**
   * 조직별 연도 순번 문서 번호 APR-YYYY-NNNN.
   * 삭제된 문서 번호도 재사용하지 않도록 deletedAt 과 무관하게 최대값을 기준으로 한다.
   * 동시 생성 충돌은 (organizationId, number) 고유 제약 위반(P2002) → 호출부에서 재시도.
   */
  async nextNumber(db: Prisma.TransactionClient, organizationId: string, now = new Date()): Promise<string> {
    const prefix = `APR-${now.getFullYear()}-`;
    const rows = await db.$queryRaw<{ n: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING("number" FROM ${prefix.length + 1}::int) AS INTEGER)) AS n
      FROM approval_requests
      WHERE "organizationId" = ${organizationId}::uuid
        AND "number" LIKE ${prefix + '%'}
        AND SUBSTRING("number" FROM ${prefix.length + 1}::int) ~ '^[0-9]+$'`;
    const next = Number(rows[0]?.n ?? 0) + 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  async users(ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter(Boolean))] as string[];
    if (!uniq.length) return new Map<string, { id: string; name: string; email: string; avatarUrl: string | null }>();
    const rows = await this.prisma.user.findMany({ where: { id: { in: uniq } }, ...approverSelect });
    return new Map(rows.map((u) => [u.id, u]));
  }
}
