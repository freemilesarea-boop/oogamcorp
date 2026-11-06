import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';

export const userSummary = { select: { id: true, name: true, email: true, avatarUrl: true } } as const;

export const taskInclude = {
  assignees: { select: { user: userSummary } },
  customStatus: { select: { id: true, name: true, color: true, category: true } },
  project: { select: { id: true, key: true, name: true } },
  _count: { select: { subtasks: { where: { deletedAt: null } } } },
} satisfies Prisma.TaskInclude;

/** 프로젝트 조회 조건 구성 (데이터 접근 계층) */
@Injectable()
export class ProjectsRepository {
  constructor(readonly prisma: PrismaService) {}

  /** 사용자가 열람 가능한 프로젝트 조건 (projects.manage 보유 시 조직 전체) */
  visibleWhere(auth: AuthContext, grantedProjectIds: string[]): Prisma.ProjectWhereInput {
    const base: Prisma.ProjectWhereInput = { organizationId: auth.organizationId, deletedAt: null };
    if (auth.permissions.has('projects.manage')) return base;
    return {
      ...base,
      OR: [
        { managerId: auth.userId },
        { createdById: auth.userId },
        { members: { some: { userId: auth.userId } } },
        ...(auth.departmentId ? [{ departmentId: auth.departmentId }] : []),
        ...(grantedProjectIds.length ? [{ id: { in: grantedProjectIds } }] : []),
      ],
    };
  }

  async grantedProjectIds(auth: AuthContext): Promise<string[]> {
    const grants = await this.prisma.resourceGrant.findMany({
      where: {
        organizationId: auth.organizationId,
        resourceType: 'PROJECT',
        OR: [{ userId: auth.userId }, ...(auth.departmentId ? [{ departmentId: auth.departmentId }] : [])],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      },
      select: { resourceId: true },
    });
    return grants.map((g) => g.resourceId);
  }

  async nextKey(organizationId: string, tx: Prisma.TransactionClient = this.prisma): Promise<string> {
    const count = await tx.project.count({ where: { organizationId } });
    return `P${String(count + 1).padStart(3, '0')}`;
  }
}
