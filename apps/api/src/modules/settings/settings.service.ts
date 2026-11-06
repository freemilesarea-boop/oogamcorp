import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS, PERMISSION_KEYS, type PermissionKey } from '@oogam/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isOwnerRank } from '../employees/role-rules';
import { CompanyInfoValue, CreateGrantDto, CreateRoleDto, GrantQueryDto, NotificationEmailValue, SetRolePermissionsDto } from './settings.dto';

/** 변경 가능한 시스템 설정 키 (허용 목록) */
export const SYSTEM_SETTING_SCHEMAS = {
  'company.info': { label: '회사 정보', schema: CompanyInfoValue, defaults: {} },
  'notifications.email': { label: '이메일 알림', schema: NotificationEmailValue, defaults: { enabled: false, taskDueReminders: true, approvalUpdates: true, announcements: true } },
} as const;
export type SystemSettingKey = keyof typeof SYSTEM_SETTING_SCHEMAS;

const isSensitive = (k: string) => (PERMISSIONS as Record<string, { sensitive: boolean }>)[k]?.sensitive === true;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── 역할 / 권한 ─────────────

  async roles(auth: AuthContext) {
    const roles = await this.prisma.role.findMany({
      where: { organizationId: auth.organizationId },
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { memberships: true } },
      },
      orderBy: { rank: 'desc' },
    });
    return roles.map(({ permissions, _count, ...r }) => ({
      ...r,
      permissions: permissions.map((p) => p.permission.key).sort(),
      memberCount: _count.memberships,
      editable: this.canEditRole(auth, r),
    }));
  }

  async permissionCatalog() {
    const rows = await this.prisma.permission.findMany({ select: { key: true, module: true, label: true, sensitive: true } });
    const order = new Map(PERMISSION_KEYS.map((k, i) => [k as string, i]));
    return rows.filter((r) => order.has(r.key)).sort((a, b) => order.get(a.key)! - order.get(b.key)!);
  }

  /** 자신보다 낮은 서열의 역할만 편집 가능. OWNER 서열은 모든 역할 편집 가능(단 OWNER 권한 축소 불가) */
  private canEditRole(auth: AuthContext, role: { rank: number }) {
    if (!auth.permissions.has('permissions.manage')) return false;
    return isOwnerRank(auth) || role.rank < auth.roleRank;
  }

  /**
   * 권한 키 변경 가능 여부 검사.
   * - 카탈로그에 존재해야 함
   * - 민감 권한(급여·재무·감사 등)의 추가/제거는 OWNER 서열만
   * - OWNER 가 아니면 자신이 보유하지 않은 권한은 부여 불가 (권한 상승 방지)
   */
  private assertPermissionChange(auth: AuthContext, keys: string[], mode: 'add' | 'remove') {
    for (const k of keys) {
      if (!PERMISSION_KEYS.includes(k as PermissionKey)) throw new BadRequestException(`알 수 없는 권한입니다: ${k}`);
      if (isSensitive(k) && !isOwnerRank(auth)) throw new ForbiddenException(`민감 권한(${k})은 최고관리자만 변경할 수 있습니다.`);
      if (mode === 'add' && !isOwnerRank(auth) && !auth.permissions.has(k as PermissionKey)) {
        throw new ForbiddenException(`보유하지 않은 권한(${k})은 부여할 수 없습니다.`);
      }
    }
  }

  private async permissionIds(keys: string[]) {
    const rows = await this.prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
    if (rows.length !== new Set(keys).size) throw new BadRequestException('권한 카탈로그가 초기화되지 않았습니다.');
    return rows;
  }

  async setRolePermissions(auth: AuthContext, roleId: string, dto: SetRolePermissionsDto) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId: auth.organizationId },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (!role) throw new NotFoundException('역할을 찾을 수 없습니다.');
    if (!this.canEditRole(auth, role)) throw new ForbiddenException('이 역할의 권한을 변경할 수 없습니다.');
    const next = [...new Set(dto.permissions)];
    const current = role.permissions.map((p) => p.permission.key);
    const added = next.filter((k) => !current.includes(k));
    const removed = current.filter((k) => !next.includes(k));
    if (role.key === 'OWNER' && removed.length) throw new BadRequestException('최고관리자(OWNER) 역할의 권한은 축소할 수 없습니다.');
    if (role.id === (await this.ownRoleId(auth)) && !isOwnerRank(auth)) throw new ForbiddenException('자신의 역할 권한은 변경할 수 없습니다.');
    this.assertPermissionChange(auth, added, 'add');
    this.assertPermissionChange(auth, removed, 'remove');
    if (!added.length && !removed.length) return (await this.roles(auth)).find((r) => r.id === roleId);

    const addRows = added.length ? await this.permissionIds(added) : [];
    await this.prisma.$transaction(async (tx) => {
      if (removed.length) {
        await tx.rolePermission.deleteMany({ where: { roleId, permission: { key: { in: removed } } } });
      }
      if (addRows.length) {
        await tx.rolePermission.createMany({ data: addRows.map((p) => ({ roleId, permissionId: p.id })), skipDuplicates: true });
      }
      await this.audit.forUser(auth, 'permissions.role.updated', { entityType: 'role', entityId: roleId, metadata: { role: role.key, added, removed } }, tx);
    });
    return (await this.roles(auth)).find((r) => r.id === roleId);
  }

  private async ownRoleId(auth: AuthContext) {
    const m = await this.prisma.membership.findUnique({ where: { id: auth.membershipId }, select: { roleId: true } });
    return m?.roleId;
  }

  async createRole(auth: AuthContext, dto: CreateRoleDto) {
    if (dto.rank >= auth.roleRank) throw new ForbiddenException('자신의 서열보다 낮은 역할만 만들 수 있습니다.');
    const keys = [...new Set(dto.permissions ?? [])];
    this.assertPermissionChange(auth, keys, 'add');
    const rows = keys.length ? await this.permissionIds(keys) : [];
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: { organizationId: auth.organizationId, key: dto.key, name: dto.name, description: dto.description, rank: dto.rank, isSystem: false },
      });
      if (rows.length) await tx.rolePermission.createMany({ data: rows.map((p) => ({ roleId: created.id, permissionId: p.id })) });
      await this.audit.forUser(auth, 'permissions.role.created', { entityType: 'role', entityId: created.id, metadata: { key: dto.key, rank: dto.rank, permissions: keys } }, tx);
      return created;
    });
    return (await this.roles(auth)).find((r) => r.id === role.id);
  }

  async deleteRole(auth: AuthContext, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId: auth.organizationId } });
    if (!role) throw new NotFoundException('역할을 찾을 수 없습니다.');
    if (role.isSystem) throw new BadRequestException('시스템 역할은 삭제할 수 없습니다.');
    if (!this.canEditRole(auth, role)) throw new ForbiddenException('이 역할을 삭제할 수 없습니다.');
    const [members, invites] = await Promise.all([
      this.prisma.membership.count({ where: { roleId } }),
      this.prisma.invitation.count({ where: { roleId } }),
    ]);
    if (members > 0) throw new ConflictException('이 역할을 사용하는 구성원이 있어 삭제할 수 없습니다.');
    if (invites > 0) {
      const pending = await this.prisma.invitation.count({ where: { roleId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (pending > 0) throw new ConflictException('이 역할로 발송된 대기 중 초대가 있어 삭제할 수 없습니다.');
      await this.prisma.invitation.deleteMany({ where: { roleId } });
    }
    await this.prisma.role.delete({ where: { id: roleId } });
    await this.audit.forUser(auth, 'permissions.role.deleted', { entityType: 'role', entityId: roleId, metadata: { key: role.key } });
    return { ok: true };
  }

  // ───────────── 모듈 권한 명시 부여 (resource_grants MODULE) ─────────────

  async grants(auth: AuthContext, q: GrantQueryDto) {
    const rows = await this.prisma.resourceGrant.findMany({
      where: {
        organizationId: auth.organizationId,
        resourceType: 'MODULE',
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      },
      include: { user: { select: { id: true, name: true, email: true } }, department: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const granterIds = [...new Set(rows.map((r) => r.grantedById).filter(Boolean))] as string[];
    const granters = await this.prisma.user.findMany({ where: { id: { in: granterIds } }, select: { id: true, name: true } });
    const g = new Map(granters.map((x) => [x.id, x]));
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      permission: r.resourceId,
      label: (PERMISSIONS as Record<string, { label: string }>)[r.resourceId]?.label ?? r.resourceId,
      sensitive: isSensitive(r.resourceId),
      user: r.user,
      department: r.department,
      expiresAt: r.expiresAt,
      expired: !!r.expiresAt && r.expiresAt <= now,
      grantedBy: r.grantedById ? g.get(r.grantedById) ?? null : null,
      createdAt: r.createdAt,
    }));
  }

  async createGrant(auth: AuthContext, dto: CreateGrantDto) {
    if (!!dto.userId === !!dto.departmentId) throw new BadRequestException('사용자 또는 부서 중 하나만 지정하세요.');
    this.assertPermissionChange(auth, [dto.permission], 'add');
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) throw new BadRequestException('만료일은 현재 이후여야 합니다.');
    if (dto.userId) {
      const m = await this.prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId: auth.organizationId, userId: dto.userId } },
        include: { role: true },
      });
      if (!m) throw new BadRequestException('조직 구성원을 찾을 수 없습니다.');
      if (m.role.rank > auth.roleRank) throw new ForbiddenException('자신보다 높은 역할의 사용자에게는 권한을 부여할 수 없습니다.');
    } else {
      const ok = await this.prisma.department.count({ where: { id: dto.departmentId, organizationId: auth.organizationId, deletedAt: null } });
      if (!ok) throw new BadRequestException('부서를 찾을 수 없습니다.');
    }
    const existing = await this.prisma.resourceGrant.findFirst({
      where: { organizationId: auth.organizationId, resourceType: 'MODULE', resourceId: dto.permission, userId: dto.userId ?? null, departmentId: dto.departmentId ?? null },
    });
    const data = { access: 'FULL' as const, grantedById: auth.userId, expiresAt };
    const grant = existing
      ? await this.prisma.resourceGrant.update({ where: { id: existing.id }, data })
      : await this.prisma.resourceGrant.create({
        data: {
          organizationId: auth.organizationId, resourceType: 'MODULE', resourceId: dto.permission,
          userId: dto.userId, departmentId: dto.departmentId, ...data,
        },
      });
    await this.audit.forUser(auth, 'permissions.grant.created', {
      entityType: dto.userId ? 'user' : 'department',
      entityId: dto.userId ?? dto.departmentId,
      metadata: { grantId: grant.id, permission: dto.permission, expiresAt },
    });
    return (await this.grants(auth, {})).find((x) => x.id === grant.id);
  }

  async deleteGrant(auth: AuthContext, id: string) {
    const g = await this.prisma.resourceGrant.findFirst({ where: { id, organizationId: auth.organizationId, resourceType: 'MODULE' } });
    if (!g) throw new NotFoundException('권한 부여 내역을 찾을 수 없습니다.');
    this.assertPermissionChange(auth, [g.resourceId].filter((k) => PERMISSION_KEYS.includes(k as PermissionKey)), 'remove');
    await this.prisma.resourceGrant.delete({ where: { id } });
    await this.audit.forUser(auth, 'permissions.grant.revoked', {
      entityType: g.userId ? 'user' : 'department',
      entityId: g.userId ?? g.departmentId ?? undefined,
      metadata: { grantId: id, permission: g.resourceId },
    });
    return { ok: true };
  }

  // ───────────── 시스템 설정 ─────────────

  private schemaFor(key: string) {
    const entry = (SYSTEM_SETTING_SCHEMAS as Record<string, (typeof SYSTEM_SETTING_SCHEMAS)[SystemSettingKey]>)[key];
    if (!entry) throw new NotFoundException('지원하지 않는 설정 키입니다.');
    return entry;
  }

  async listSystem(auth: AuthContext) {
    const rows = await this.prisma.systemSetting.findMany({ where: { organizationId: auth.organizationId, key: { in: Object.keys(SYSTEM_SETTING_SCHEMAS) } } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return Object.entries(SYSTEM_SETTING_SCHEMAS).map(([key, e]) => ({
      key,
      label: e.label,
      value: (byKey.get(key)?.value as Record<string, unknown> | undefined) ?? e.defaults,
      updatedAt: byKey.get(key)?.updatedAt ?? null,
    }));
  }

  async getSystem(auth: AuthContext, key: string) {
    const e = this.schemaFor(key);
    const row = await this.prisma.systemSetting.findUnique({ where: { organizationId_key: { organizationId: auth.organizationId, key } } });
    return { key, label: e.label, value: (row?.value as Record<string, unknown> | undefined) ?? e.defaults, updatedAt: row?.updatedAt ?? null };
  }

  async putSystem(auth: AuthContext, key: string, value: Record<string, unknown>) {
    const e = this.schemaFor(key);
    const instance = plainToInstance(e.schema as new () => object, value);
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      throw new BadRequestException(errors.flatMap((er) => Object.values(er.constraints ?? { [er.property]: `${er.property} 값이 올바르지 않습니다.` })));
    }
    const clean = JSON.parse(JSON.stringify(instance)) as Prisma.InputJsonValue;
    const row = await this.prisma.systemSetting.upsert({
      where: { organizationId_key: { organizationId: auth.organizationId, key } },
      create: { organizationId: auth.organizationId, key, value: clean, updatedById: auth.userId },
      update: { value: clean, updatedById: auth.userId },
    });
    await this.audit.forUser(auth, 'settings.updated', { entityType: 'system_setting', entityId: key, metadata: { fields: Object.keys(value) } });
    return { key, label: e.label, value: row.value, updatedAt: row.updatedAt };
  }
}
