import { Prisma, ResourceType } from '@prisma/client';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * 목록형 조회(검색·캘린더)를 위한 WHERE 조건.
 * ProjectsRepository.visibleWhere / TasksService.list / EntityAccessService 의 규칙을 그대로 반영한다.
 * (규칙 변경 시 함께 수정해야 하며, 문서(Page) 는 상속 규칙 때문에 후보 조회 후 pageLevel() 로 재검증한다.)
 */
export async function grantedIds(prisma: PrismaService, auth: AuthContext, type: ResourceType): Promise<string[]> {
  const grants = await prisma.resourceGrant.findMany({
    where: {
      organizationId: auth.organizationId,
      resourceType: type,
      OR: [{ userId: auth.userId }, ...(auth.departmentId ? [{ departmentId: auth.departmentId }] : [])],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
    },
    select: { resourceId: true },
  });
  return grants.map((g) => g.resourceId);
}

export function projectVisibleWhere(auth: AuthContext, granted: string[]): Prisma.ProjectWhereInput {
  const base: Prisma.ProjectWhereInput = { organizationId: auth.organizationId, deletedAt: null };
  if (auth.permissions.has('projects.manage')) return base;
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

export function taskVisibleWhere(auth: AuthContext, grantedProjects: string[]): Prisma.TaskWhereInput {
  return {
    organizationId: auth.organizationId,
    deletedAt: null,
    OR: [
      { project: projectVisibleWhere(auth, grantedProjects) },
      { projectId: null, createdById: auth.userId },
      { assignees: { some: { userId: auth.userId } } },
    ],
  };
}

/** 일정 열람 조건: 비공개가 아니거나, 작성자/참석자 */
export function eventVisibleWhere(auth: AuthContext): Prisma.CalendarEventWhereInput {
  return {
    organizationId: auth.organizationId,
    deletedAt: null,
    OR: [{ isPrivate: false }, { createdById: auth.userId }, { attendees: { some: { userId: auth.userId } } }],
  };
}
