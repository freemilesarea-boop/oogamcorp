import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AssignMembersDto, CreateDepartmentDto, DeleteDepartmentQueryDto, UpdateDepartmentDto } from './teams.dto';

const activeMember: Prisma.MembershipWhereInput = { employmentStatus: { not: 'RESIGNED' }, user: { deletedAt: null } };

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async require(auth: AuthContext, id: string) {
    const d = await this.prisma.department.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null } });
    if (!d) throw new NotFoundException('부서를 찾을 수 없습니다.');
    return d;
  }

  private async managers(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    const users = unique.length ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true, avatarUrl: true } }) : [];
    return new Map(users.map((u) => [u.id, u]));
  }

  /** 전체 부서 (평면 목록 + parentId — 클라이언트에서 트리 구성) */
  async list(auth: AuthContext) {
    const rows = await this.prisma.department.findMany({
      where: { organizationId: auth.organizationId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { memberships: { where: activeMember } } } },
    });
    const mgr = await this.managers(rows.map((r) => r.managerId));
    return rows.map(({ _count, ...d }) => ({ ...d, memberCount: _count.memberships, manager: d.managerId ? mgr.get(d.managerId) ?? null : null }));
  }

  async get(auth: AuthContext, id: string) {
    const d = await this.require(auth, id);
    const [members, children] = await Promise.all([
      this.members(auth, id),
      this.prisma.department.findMany({ where: { parentId: id, deletedAt: null }, select: { id: true, name: true } }),
    ]);
    const mgr = await this.managers([d.managerId]);
    return { ...d, manager: d.managerId ? mgr.get(d.managerId) ?? null : null, members, children };
  }

  async members(auth: AuthContext, id: string) {
    await this.require(auth, id);
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: auth.organizationId, departmentId: id, ...activeMember },
      select: {
        title: true,
        employmentStatus: true,
        role: { select: { key: true, name: true } },
        user: { select: { id: true, name: true, email: true, avatarUrl: true, status: true } },
      },
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map((r) => ({ ...r.user, title: r.title, role: r.role, employmentStatus: r.employmentStatus }));
  }

  private async assertManager(auth: AuthContext, managerId: string | null | undefined) {
    if (!managerId) return;
    const ok = await this.prisma.membership.count({ where: { organizationId: auth.organizationId, userId: managerId, ...activeMember } });
    if (!ok) throw new BadRequestException('부서장은 조직의 재직 중인 구성원이어야 합니다.');
  }

  /** 상위 부서 지정 시 순환 구조 방지 */
  private async assertParent(auth: AuthContext, id: string | null, parentId: string | null | undefined) {
    if (!parentId) return;
    if (id && parentId === id) throw new BadRequestException('자기 자신을 상위 부서로 지정할 수 없습니다.');
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor) || seen.size > 100) throw new BadRequestException('부서 구조가 올바르지 않습니다.');
      seen.add(cursor);
      const node: { id: string; parentId: string | null } | null = await this.prisma.department.findFirst({
        where: { id: cursor, organizationId: auth.organizationId, deletedAt: null },
        select: { id: true, parentId: true },
      });
      if (!node) throw new BadRequestException('상위 부서를 찾을 수 없습니다.');
      if (id && node.parentId === id) throw new BadRequestException('하위 부서를 상위 부서로 지정할 수 없습니다 (순환 구조).');
      cursor = node.parentId;
    }
  }

  async create(auth: AuthContext, dto: CreateDepartmentDto) {
    await this.assertParent(auth, null, dto.parentId);
    await this.assertManager(auth, dto.managerId);
    const d = await this.prisma.department.create({
      data: { organizationId: auth.organizationId, ...dto },
    });
    await this.audit.forUser(auth, 'department.created', { entityType: 'department', entityId: d.id, metadata: { name: d.name } });
    return d;
  }

  async update(auth: AuthContext, id: string, dto: UpdateDepartmentDto) {
    await this.require(auth, id);
    await this.assertParent(auth, id, dto.parentId);
    await this.assertManager(auth, dto.managerId);
    const d = await this.prisma.department.update({ where: { id }, data: dto });
    await this.audit.forUser(auth, 'department.updated', { entityType: 'department', entityId: id, metadata: { fields: Object.keys(dto) } });
    return d;
  }

  async assignMembers(auth: AuthContext, id: string, dto: AssignMembersDto) {
    await this.require(auth, id);
    const ids = [...new Set(dto.userIds)];
    const count = await this.prisma.membership.count({ where: { organizationId: auth.organizationId, userId: { in: ids } } });
    if (count !== ids.length) throw new BadRequestException('조직에 속하지 않은 사용자가 포함되어 있습니다.');
    const r = await this.prisma.membership.updateMany({ where: { organizationId: auth.organizationId, userId: { in: ids } }, data: { departmentId: id } });
    await this.audit.forUser(auth, 'department.members.assigned', { entityType: 'department', entityId: id, metadata: { userIds: ids } });
    return { updated: r.count };
  }

  async removeMember(auth: AuthContext, id: string, userId: string) {
    await this.require(auth, id);
    const r = await this.prisma.membership.updateMany({ where: { organizationId: auth.organizationId, userId, departmentId: id }, data: { departmentId: null } });
    if (!r.count) throw new NotFoundException('부서 구성원이 아닙니다.');
    await this.audit.forUser(auth, 'department.member.removed', { entityType: 'department', entityId: id, metadata: { userId } });
    return { ok: true };
  }

  /** 소프트 삭제. 재직 중인 구성원이 있으면 moveTo 로 이동시킨 뒤에만 삭제 가능 */
  async remove(auth: AuthContext, id: string, q: DeleteDepartmentQueryDto) {
    const d = await this.require(auth, id);
    const active = await this.prisma.membership.count({ where: { organizationId: auth.organizationId, departmentId: id, ...activeMember } });
    if (q.moveTo) {
      if (q.moveTo === id) throw new BadRequestException('같은 부서로 이동할 수 없습니다.');
      await this.require(auth, q.moveTo);
    } else if (active > 0) {
      throw new ConflictException(`재직 중인 구성원 ${active}명이 있어 삭제할 수 없습니다. 구성원을 다른 부서로 옮긴 뒤 삭제하세요.`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.updateMany({ where: { organizationId: auth.organizationId, departmentId: id }, data: { departmentId: q.moveTo ?? null } });
      await tx.department.updateMany({ where: { parentId: id, deletedAt: null }, data: { parentId: d.parentId } });
      // 동일 이름 부서를 다시 만들 수 있도록 삭제된 부서명은 고유하게 변경
      await tx.department.update({ where: { id }, data: { deletedAt: new Date(), name: `${d.name} (삭제됨 ${id.slice(0, 8)})`.slice(0, 190), managerId: null } });
      await this.audit.forUser(auth, 'department.deleted', { entityType: 'department', entityId: id, metadata: { name: d.name, movedMembers: active, moveTo: q.moveTo ?? null } }, tx);
    });
    return { ok: true };
  }
}
