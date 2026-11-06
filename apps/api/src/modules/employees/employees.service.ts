import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmploymentStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { SessionService } from '../../common/auth/session.service';
import { pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChangeRoleDto, DeactivateDto, EmployeeQueryDto, UpdateEmployeeDto, UpdateHrRecordDto } from './employees.dto';
import { visibleProjectIds } from './project-visibility';
import { assertCanAssignRole, assertCanManageMember, assertNotLastOwner } from './role-rules';

const SORTS = ['name', 'hireDate', 'createdAt', 'lastLoginAt'] as const;

/**
 * 직원 목록/상세에 노출하는 필드. 민감 인사정보(hr_records)는 절대 포함하지 않는다.
 */
const memberSelect = {
  id: true,
  title: true,
  employeeNumber: true,
  phone: true,
  hireDate: true,
  employmentStatus: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
  role: { select: { id: true, key: true, name: true, rank: true } },
  user: { select: { id: true, name: true, email: true, avatarUrl: true, status: true, lastLoginAt: true } },
} satisfies Prisma.MembershipSelect;

type MemberRow = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

function present(m: MemberRow, viewerCanManage: boolean) {
  return {
    id: m.user.id,
    membershipId: m.id,
    name: m.user.name,
    email: m.user.email,
    avatarUrl: m.user.avatarUrl,
    accountStatus: m.user.status,
    lastLoginAt: m.user.lastLoginAt,
    title: m.title,
    department: m.department,
    role: { id: m.role.id, key: m.role.key, name: m.role.name, rank: m.role.rank },
    employmentStatus: m.employmentStatus,
    hireDate: m.hireDate,
    // 사번·연락처는 관리자에게만 노출
    employeeNumber: viewerCanManage ? m.employeeNumber : undefined,
    phone: viewerCanManage ? m.phone : undefined,
  };
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, q: EmployeeQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.MembershipWhereInput = {
      organizationId: auth.organizationId,
      user: {
        deletedAt: null,
        ...(q.accountStatus ? { status: q.accountStatus } : {}),
        ...(q.q
          ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] }
          : {}),
      },
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.role ? { role: { key: q.role } } : {}),
      ...(q.status ? { employmentStatus: q.status } : {}),
    };
    const field = (SORTS as readonly string[]).includes(q.sort ?? '') ? (q.sort as (typeof SORTS)[number]) : 'name';
    const dir = q.sort ? (q.order ?? 'desc') : 'asc';
    const orderBy: Prisma.MembershipOrderByWithRelationInput =
      field === 'name' ? { user: { name: dir } }
        : field === 'lastLoginAt' ? { user: { lastLoginAt: { sort: dir, nulls: 'last' } } }
          : field === 'hireDate' ? { hireDate: { sort: dir, nulls: 'last' } }
            : { createdAt: dir };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.membership.findMany({ where, select: memberSelect, orderBy, skip, take }),
      this.prisma.membership.count({ where }),
    ]);
    const canManage = auth.permissions.has('employees.manage');
    return paginated(rows.map((r) => present(r, canManage)), total, page, pageSize);
  }

  roles(auth: AuthContext) {
    return this.prisma.role.findMany({
      where: { organizationId: auth.organizationId },
      select: { id: true, key: true, name: true, rank: true, isSystem: true },
      orderBy: { rank: 'desc' },
    });
  }

  private async findMember(auth: AuthContext, userId: string) {
    const m = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: auth.organizationId, userId } },
      select: memberSelect,
    });
    if (!m || (await this.prisma.user.count({ where: { id: userId, deletedAt: null } })) === 0) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }
    return m;
  }

  async detail(auth: AuthContext, userId: string) {
    const m = await this.findMember(auth, userId);
    const projectIds = await visibleProjectIds(this.prisma, auth);
    const [projects, openTasks, openTaskCount, activityRaw] = await Promise.all([
      projectIds.length
        ? this.prisma.project.findMany({
          where: { id: { in: projectIds }, OR: [{ managerId: userId }, { members: { some: { userId } } }] },
          select: { id: true, key: true, name: true, status: true, endDate: true, members: { where: { userId }, select: { role: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        })
        : [],
      projectIds.length
        ? this.prisma.task.findMany({
          where: { deletedAt: null, status: { not: 'DONE' }, projectId: { in: projectIds }, assignees: { some: { userId } } },
          select: { id: true, title: true, status: true, priority: true, dueDate: true, project: { select: { id: true, key: true, name: true } } },
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
          take: 10,
        })
        : [],
      projectIds.length
        ? this.prisma.task.count({ where: { deletedAt: null, status: { not: 'DONE' }, projectId: { in: projectIds }, assignees: { some: { userId } } } })
        : 0,
      this.prisma.activityLog.findMany({
        where: { organizationId: auth.organizationId, actorId: userId, entityType: { in: ['PROJECT', 'TASK'] } },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
    ]);
    // 활동 이력도 보는 사람이 접근 가능한 프로젝트 범위로 제한
    const visible = new Set(projectIds);
    const taskIds = activityRaw.filter((a) => a.entityType === 'TASK').map((a) => a.entityId);
    const taskRows = taskIds.length
      ? await this.prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true, projectId: true } })
      : [];
    const taskMap = new Map(taskRows.map((t) => [t.id, t]));
    const projectNames = new Map(
      (await this.prisma.project.findMany({ where: { id: { in: [...visible] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]),
    );
    const recentActivity = activityRaw
      .filter((a) => (a.entityType === 'PROJECT' ? visible.has(a.entityId) : !!taskMap.get(a.entityId)?.projectId && visible.has(taskMap.get(a.entityId)!.projectId!)))
      .slice(0, 15)
      .map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        label: a.entityType === 'PROJECT' ? projectNames.get(a.entityId) ?? null : taskMap.get(a.entityId)?.title ?? null,
        createdAt: a.createdAt,
      }));

    return {
      ...present(m, auth.permissions.has('employees.manage')),
      projects: projects.map((p) => ({ id: p.id, key: p.key, name: p.name, status: p.status, endDate: p.endDate, memberRole: p.members[0]?.role ?? 'MANAGER' })),
      openTaskCount,
      openTasks,
      recentActivity,
    };
  }

  private async assertDepartment(auth: AuthContext, departmentId: string | null | undefined) {
    if (!departmentId) return;
    const ok = await this.prisma.department.count({ where: { id: departmentId, organizationId: auth.organizationId, deletedAt: null } });
    if (!ok) throw new BadRequestException('부서를 찾을 수 없습니다.');
  }

  async update(auth: AuthContext, userId: string, dto: UpdateEmployeeDto) {
    const m = await this.findMember(auth, userId);
    assertCanManageMember(auth, m.role);
    await this.assertDepartment(auth, dto.departmentId);
    const resigning = dto.employmentStatus === EmploymentStatus.RESIGNED && m.employmentStatus !== EmploymentStatus.RESIGNED;
    if (resigning) {
      if (userId === auth.userId) throw new BadRequestException('본인을 퇴사 처리할 수 없습니다.');
      await assertNotLastOwner(this.prisma, auth.organizationId, { userId, roleKey: m.role.key });
    }
    const data: Prisma.MembershipUncheckedUpdateInput = {
      title: dto.title,
      departmentId: dto.departmentId,
      hireDate: dto.hireDate === undefined ? undefined : dto.hireDate === null ? null : new Date(dto.hireDate),
      employeeNumber: dto.employeeNumber === '' ? null : dto.employeeNumber,
      phone: dto.phone === '' ? null : dto.phone,
      employmentStatus: dto.employmentStatus,
    };
    await this.prisma.membership.update({ where: { id: m.id }, data });
    if (resigning) await this.sessions.revokeAllForUser(userId);
    const fields = Object.entries(dto).filter(([, v]) => v !== undefined).map(([k]) => k);
    await this.audit.forUser(auth, 'employee.updated', { entityType: 'user', entityId: userId, metadata: { fields, departmentId: dto.departmentId, employmentStatus: dto.employmentStatus } });
    return this.detail(auth, userId);
  }

  async changeRole(auth: AuthContext, userId: string, dto: ChangeRoleDto) {
    if (userId === auth.userId) throw new BadRequestException('본인의 역할은 변경할 수 없습니다.');
    const m = await this.findMember(auth, userId);
    assertCanManageMember(auth, m.role);
    const role = await this.prisma.role.findFirst({ where: { id: dto.roleId, organizationId: auth.organizationId } });
    if (!role) throw new BadRequestException('역할을 찾을 수 없습니다.');
    assertCanAssignRole(auth, role);
    if (role.id === m.role.id) return this.detail(auth, userId);
    if (role.key !== 'OWNER') await assertNotLastOwner(this.prisma, auth.organizationId, { userId, roleKey: m.role.key });
    await this.prisma.membership.update({ where: { id: m.id }, data: { roleId: role.id } });
    // 세션은 요청마다 역할 권한을 재계산하므로 변경 즉시 적용된다
    await this.audit.forUser(auth, 'employee.role.changed', { entityType: 'user', entityId: userId, metadata: { from: m.role.key, to: role.key } });
    return this.detail(auth, userId);
  }

  async deactivate(auth: AuthContext, userId: string, dto: DeactivateDto) {
    if (userId === auth.userId) throw new BadRequestException('본인 계정은 비활성화할 수 없습니다.');
    const m = await this.findMember(auth, userId);
    assertCanManageMember(auth, m.role);
    await assertNotLastOwner(this.prisma, auth.organizationId, { userId, roleKey: m.role.key });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { status: 'DISABLED' } }),
      ...(dto.resign ? [this.prisma.membership.update({ where: { id: m.id }, data: { employmentStatus: 'RESIGNED' } })] : []),
    ]);
    const revoked = await this.sessions.revokeAllForUser(userId);
    await this.audit.forUser(auth, 'employee.deactivated', { entityType: 'user', entityId: userId, metadata: { resign: !!dto.resign, revokedSessions: revoked } });
    return { ok: true, revokedSessions: revoked };
  }

  async reactivate(auth: AuthContext, userId: string) {
    const m = await this.findMember(auth, userId);
    assertCanManageMember(auth, m.role);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true, passwordHash: true } });
    if (!user.passwordHash) throw new BadRequestException('초대를 수락하지 않은 계정은 재활성화할 수 없습니다. 초대를 다시 보내세요.');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null } }),
      this.prisma.membership.update({
        where: { id: m.id },
        data: { employmentStatus: m.employmentStatus === 'RESIGNED' ? 'ACTIVE' : m.employmentStatus },
      }),
    ]);
    await this.audit.forUser(auth, 'employee.reactivated', { entityType: 'user', entityId: userId });
    return { ok: true };
  }

  // ───────────── 민감 인사정보 (hr.sensitive.*) ─────────────

  private serializeHr(r: { annualSalary: Prisma.Decimal | null; salaryNote: string | null; bankAccount: string | null; emergencyInfo: string | null; updatedAt: Date } | null) {
    return {
      annualSalary: r?.annualSalary ? r.annualSalary.toFixed(2) : null,
      salaryNote: r?.salaryNote ?? null,
      bankAccount: r?.bankAccount ?? null,
      emergencyInfo: r?.emergencyInfo ?? null,
      updatedAt: r?.updatedAt ?? null,
    };
  }

  async getHr(auth: AuthContext, userId: string, meta: { ip?: string; userAgent?: string }) {
    if (!auth.permissions.has('hr.sensitive.read')) throw new ForbiddenException('민감 인사정보 열람 권한이 없습니다.');
    const m = await this.findMember(auth, userId);
    const record = await this.prisma.hrRecord.findUnique({ where: { membershipId: m.id } });
    await this.audit.forUser(auth, 'hr.record.viewed', { entityType: 'user', entityId: userId, ...meta });
    return this.serializeHr(record);
  }

  async updateHr(auth: AuthContext, userId: string, dto: UpdateHrRecordDto, meta: { ip?: string; userAgent?: string }) {
    if (!auth.permissions.has('hr.sensitive.write')) throw new ForbiddenException('민감 인사정보 수정 권한이 없습니다.');
    const m = await this.findMember(auth, userId);
    const data = {
      annualSalary: dto.annualSalary === undefined ? undefined : dto.annualSalary === null ? null : new Prisma.Decimal(dto.annualSalary),
      salaryNote: dto.salaryNote,
      bankAccount: dto.bankAccount,
      emergencyInfo: dto.emergencyInfo,
    };
    const record = await this.prisma.hrRecord.upsert({
      where: { membershipId: m.id },
      create: { membershipId: m.id, ...data },
      update: data,
    });
    // 감사 로그에는 변경된 필드명만 기록 (값은 기록하지 않음)
    const fields = Object.entries(dto).filter(([, v]) => v !== undefined).map(([k]) => k);
    await this.audit.forUser(auth, 'hr.record.updated', { entityType: 'user', entityId: userId, metadata: { fields }, ...meta });
    return this.serializeHr(record);
  }
}

