import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessLevel, Prisma, ResourceType } from '@prisma/client';
import { PERMISSION_KEYS, type PermissionKey } from '@oogam/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from './auth.types';

const LEVEL_RANK: Record<AccessLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 };

/**
 * 권한 해석 서비스.
 * 유효 권한 = 역할 권한(role_permissions) ∪ 모듈 단위 명시 부여(resource_grants, resourceType=MODULE)
 * 리소스 접근 = 소유/구성원 여부 ∪ 리소스 단위 명시 부여(resource_grants)
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolvePermissions(params: {
    organizationId: string;
    userId: string;
    roleId: string;
    departmentId: string | null;
  }): Promise<Set<PermissionKey>> {
    const now = new Date();
    const [rolePerms, grants] = await Promise.all([
      this.prisma.rolePermission.findMany({
        where: { roleId: params.roleId },
        select: { permission: { select: { key: true } } },
      }),
      this.prisma.resourceGrant.findMany({
        where: {
          organizationId: params.organizationId,
          resourceType: ResourceType.MODULE,
          OR: [
            { userId: params.userId },
            ...(params.departmentId ? [{ departmentId: params.departmentId }] : []),
          ],
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        },
        select: { resourceId: true },
      }),
    ]);
    const valid = new Set<string>(PERMISSION_KEYS);
    const set = new Set<PermissionKey>();
    for (const rp of rolePerms) if (valid.has(rp.permission.key)) set.add(rp.permission.key as PermissionKey);
    for (const g of grants) if (valid.has(g.resourceId)) set.add(g.resourceId as PermissionKey);
    return set;
  }

  has(auth: AuthContext, perm: PermissionKey): boolean {
    return auth.permissions.has(perm);
  }

  assert(auth: AuthContext, perm: PermissionKey, message = '이 작업에 대한 권한이 없습니다.'): void {
    if (!auth.permissions.has(perm)) throw new ForbiddenException(message);
  }

  /** 리소스 단위 명시 부여 중 최고 접근 수준 */
  async grantedLevel(
    auth: AuthContext,
    resourceType: ResourceType,
    resourceId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<AccessLevel | null> {
    const now = new Date();
    const grants = await tx.resourceGrant.findMany({
      where: {
        organizationId: auth.organizationId,
        resourceType,
        resourceId,
        OR: [{ userId: auth.userId }, ...(auth.departmentId ? [{ departmentId: auth.departmentId }] : [])],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { access: true },
    });
    let best: AccessLevel | null = null;
    for (const g of grants) if (!best || LEVEL_RANK[g.access] > LEVEL_RANK[best]) best = g.access;
    return best;
  }

  static atLeast(level: AccessLevel | null, required: AccessLevel): boolean {
    return !!level && LEVEL_RANK[level] >= LEVEL_RANK[required];
  }
}
