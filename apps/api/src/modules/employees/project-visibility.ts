import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/auth/auth.types';
import type { PrismaService } from '../../common/prisma/prisma.service';

/**
 * 열람 가능한 프로젝트 조건 (projects 모듈의 ProjectsRepository.visibleWhere 와 동일 규칙).
 * 직원 상세·공지·대시보드에서 "보는 사람이 볼 수 있는 프로젝트"만 노출하기 위해 사용한다.
 * projects.read 권한이 없으면 아무 프로젝트도 매칭되지 않는 조건을 반환한다.
 */
export async function visibleProjectWhere(prisma: PrismaService, auth: AuthContext): Promise<Prisma.ProjectWhereInput> {
  const base: Prisma.ProjectWhereInput = { organizationId: auth.organizationId, deletedAt: null };
  if (!auth.permissions.has('projects.read')) return { ...base, id: { in: [] } };
  if (auth.permissions.has('projects.manage')) return base;
  const grants = await prisma.resourceGrant.findMany({
    where: {
      organizationId: auth.organizationId,
      resourceType: 'PROJECT',
      OR: [{ userId: auth.userId }, ...(auth.departmentId ? [{ departmentId: auth.departmentId }] : [])],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
    },
    select: { resourceId: true },
  });
  const granted = grants.map((g) => g.resourceId);
  return {
    ...base,
    OR: [
      { managerId: auth.userId },
      { createdById: auth.userId },
      { members: { some: { userId: auth.userId } } },
      ...(auth.departmentId ? [{ departmentId: auth.departmentId }] : []),
      ...(granted.length ? [{ id: { in: granted } }] : []),
    ],
  };
}

export async function visibleProjectIds(prisma: PrismaService, auth: AuthContext): Promise<string[]> {
  const rows = await prisma.project.findMany({ where: await visibleProjectWhere(prisma, auth), select: { id: true } });
  return rows.map((r) => r.id);
}

export const userLite = { select: { id: true, name: true, email: true, avatarUrl: true } } as const;
