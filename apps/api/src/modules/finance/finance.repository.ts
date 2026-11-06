import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { fromMinor, toMinor } from '@oogam/shared';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/** Prisma.Decimal → "1234.50" (응답 직렬화용, 항상 소수점 2자리 문자열) */
export function money(d: Prisma.Decimal | null | undefined): string {
  return d == null ? '0.00' : d.toFixed(2);
}

/** Prisma.Decimal | 문자열 → 최소 단위(BigInt) */
export function minorOf(d: Prisma.Decimal | string | null | undefined): bigint {
  if (d == null) return 0n;
  return toMinor(typeof d === 'string' ? d : d.toFixed(2));
}

export function sumMinor(values: (Prisma.Decimal | string | null | undefined)[]): bigint {
  return values.reduce<bigint>((acc, v) => acc + minorOf(v), 0n);
}

/** 집행률(%) 소수 첫째 자리. 분모 0 이면 0 */
export function rate(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number((part * 1000n) / whole) / 10;
}

export { fromMinor };

/** 재무 모듈 공통 데이터 접근 계층 (조직 격리 참조 검증, 집행 집계, 이름 조회) */
@Injectable()
export class FinanceRepository {
  constructor(readonly prisma: PrismaService) {}

  /** 참조 엔터티가 같은 조직에 속하는지 검증 */
  async assertRefs(
    auth: AuthContext,
    refs: { departmentId?: string | null; projectId?: string | null; businessUnitId?: string | null; evidenceFileId?: string | null },
    db: Db = this.prisma,
  ) {
    const org = auth.organizationId;
    if (refs.departmentId && !(await db.department.count({ where: { id: refs.departmentId, organizationId: org, deletedAt: null } }))) {
      throw new BadRequestException('부서를 찾을 수 없습니다.');
    }
    if (refs.projectId && !(await db.project.count({ where: { id: refs.projectId, organizationId: org, deletedAt: null } }))) {
      throw new BadRequestException('프로젝트를 찾을 수 없습니다.');
    }
    if (refs.businessUnitId && !(await db.businessUnit.count({ where: { id: refs.businessUnitId, organizationId: org } }))) {
      throw new BadRequestException('사업 구분을 찾을 수 없습니다.');
    }
    if (refs.evidenceFileId && !(await db.file.count({ where: { id: refs.evidenceFileId, organizationId: org, deletedAt: null } }))) {
      throw new BadRequestException('증빙 파일을 찾을 수 없습니다.');
    }
  }

  /**
   * 예산 항목별 집행액 = 승인(APPROVED)된 지출(EXPENSE) 거래의 배분 금액 합계.
   * 승인 금액(budget_lines.approvedAmount)과 별도로 집계한다.
   */
  async executedByLine(organizationId: string, lineIds: string[], db: Db = this.prisma): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>();
    if (!lineIds.length) return out;
    const rows = await db.transactionAllocation.groupBy({
      by: ['budgetLineId'],
      where: {
        budgetLineId: { in: lineIds },
        transaction: { organizationId, status: 'APPROVED', type: 'EXPENSE', deletedAt: null },
      },
      _sum: { amount: true },
    });
    for (const r of rows) out.set(r.budgetLineId, minorOf(r._sum.amount));
    return out;
  }

  async userNames(ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter(Boolean))] as string[];
    if (!uniq.length) return new Map<string, { id: string; name: string; email: string }>();
    const users = await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } });
    return new Map(users.map((u) => [u.id, u]));
  }

  async projectNames(organizationId: string, ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter(Boolean))] as string[];
    if (!uniq.length) return new Map<string, { id: string; key: string; name: string }>();
    const rows = await this.prisma.project.findMany({ where: { id: { in: uniq }, organizationId }, select: { id: true, key: true, name: true } });
    return new Map(rows.map((p) => [p.id, p]));
  }

  async departmentNames(organizationId: string, ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter(Boolean))] as string[];
    if (!uniq.length) return new Map<string, { id: string; name: string }>();
    const rows = await this.prisma.department.findMany({ where: { id: { in: uniq }, organizationId }, select: { id: true, name: true } });
    return new Map(rows.map((p) => [p.id, p]));
  }
}
