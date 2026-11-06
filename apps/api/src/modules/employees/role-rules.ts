import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ROLE_RANK } from '@oogam/shared';
import type { AuthContext } from '../../common/auth/auth.types';
import type { PrismaService } from '../../common/prisma/prisma.service';

/** OWNER 서열 (최고관리자). OWNER 역할 부여·민감 권한 정책 변경은 이 서열 이상만 가능 */
export const OWNER_RANK = ROLE_RANK.OWNER;

export function isOwnerRank(auth: AuthContext): boolean {
  return auth.roleRank >= OWNER_RANK;
}

/**
 * 역할 부여 규칙.
 * - 자신의 서열보다 높은 역할은 부여할 수 없다.
 * - OWNER(최고관리자) 역할은 OWNER 서열만 부여할 수 있다.
 */
export function assertCanAssignRole(auth: AuthContext, role: { key: string; rank: number }): void {
  if (role.rank > auth.roleRank) throw new ForbiddenException('자신보다 높은 역할은 부여할 수 없습니다.');
  if ((role.key === 'OWNER' || role.rank >= OWNER_RANK) && !isOwnerRank(auth)) {
    throw new ForbiddenException('최고관리자 역할은 최고관리자만 부여할 수 있습니다.');
  }
}

/** 대상 사용자의 역할 서열이 자신보다 높으면 관리할 수 없다 */
export function assertCanManageMember(auth: AuthContext, target: { rank: number }): void {
  if (target.rank > auth.roleRank) throw new ForbiddenException('자신보다 높은 역할의 사용자는 변경할 수 없습니다.');
}

/** 활성 최고관리자 수 */
export function countActiveOwners(prisma: PrismaService, organizationId: string, excludeUserId?: string): Promise<number> {
  return prisma.membership.count({
    where: {
      organizationId,
      role: { key: 'OWNER' },
      employmentStatus: { not: 'RESIGNED' },
      user: { status: 'ACTIVE', deletedAt: null },
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
  });
}

/** 마지막 활성 최고관리자를 강등/비활성화하지 못하도록 보호 */
export async function assertNotLastOwner(prisma: PrismaService, organizationId: string, target: { userId: string; roleKey: string }): Promise<void> {
  if (target.roleKey !== 'OWNER') return;
  const others = await countActiveOwners(prisma, organizationId, target.userId);
  if (others < 1) throw new BadRequestException('마지막 최고관리자는 강등하거나 비활성화할 수 없습니다.');
}
