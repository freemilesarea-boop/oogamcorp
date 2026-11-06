import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Database, DatabaseProperty, DbPropertyType, EntityType, Prisma } from '@prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntityAccessService } from '../access/entity-access.service';
import {
  CreateDatabaseDto, CreatePropertyDto, CreateViewDto, DatabaseQueryDto, UpdateDatabaseDto, UpdatePropertyDto, UpdateViewDto, ViewPreferenceDto,
} from './dto/database.dto';
import { sanitizeViewConfig, validateViewConfig } from './query';
import { assertSupportedType, cfg, convertValue, normalizeConfig, type PropertyConfig } from './schema';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const REF_TYPES: DbPropertyType[] = ['PERSON', 'FILE', 'RELATION'];

/** 데이터베이스·속성·뷰 관리. 모든 접근은 EntityAccessService.can(DATABASE) 기준 */
@Injectable()
export class DatabasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entityAccess: EntityAccessService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
  ) {}

  /** 데이터베이스 조회 + 접근 확인 (열람 불가 시 404 로 존재 은닉, 편집 불가 시 403) */
  async requireDb(auth: AuthContext, id: string, need: 'view' | 'edit'): Promise<Database> {
    const db = await this.prisma.database.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null } });
    if (!db || !(await this.entityAccess.can(auth, 'DATABASE', id, 'view'))) throw new NotFoundException('데이터베이스를 찾을 수 없습니다.');
    if (need === 'edit' && !(await this.entityAccess.can(auth, 'DATABASE', id, 'edit'))) {
      throw new ForbiddenException('데이터베이스 편집 권한이 없습니다.');
    }
    return db;
  }

  properties(databaseId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.databaseProperty.findMany({ where: { databaseId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  }

  async grantedDatabaseIds(auth: AuthContext): Promise<string[]> {
    const grants = await this.prisma.resourceGrant.findMany({
      where: {
        organizationId: auth.organizationId,
        resourceType: 'DATABASE',
        OR: [{ userId: auth.userId }, ...(auth.departmentId ? [{ departmentId: auth.departmentId }] : [])],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      },
      select: { resourceId: true },
    });
    return grants.map((g) => g.resourceId);
  }

  /** EntityAccessService.can(DATABASE) 와 동일한 열람 조건 (워크스페이스 구성원 또는 명시 부여) */
  async visibleWhere(auth: AuthContext): Promise<Prisma.DatabaseWhereInput> {
    const granted = await this.grantedDatabaseIds(auth);
    return {
      organizationId: auth.organizationId,
      deletedAt: null,
      OR: [
        { workspace: { members: { some: { userId: auth.userId } } } },
        ...(granted.length ? [{ id: { in: granted } }] : []),
      ],
    };
  }

  // ───────────── Databases ─────────────
  async list(auth: AuthContext, q: DatabaseQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.DatabaseWhereInput = {
      AND: [
        await this.visibleWhere(auth),
        q.workspaceId ? { workspaceId: q.workspaceId } : {},
        q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.database.findMany({
        where,
        skip,
        take,
        orderBy: orderByArg(q, ['createdAt', 'updatedAt', 'name'] as const, 'updatedAt'),
        include: {
          workspace: { select: { id: true, name: true } },
          _count: { select: { rows: { where: { deletedAt: null } }, properties: true } },
        },
      }),
      this.prisma.database.count({ where }),
    ]);
    return paginated(
      items.map(({ _count, ...d }) => ({ ...d, rowCount: _count.rows, propertyCount: _count.properties })),
      total,
      page,
      pageSize,
    );
  }

  async create(auth: AuthContext, dto: CreateDatabaseDto) {
    const ws = dto.workspaceId
      ? await this.prisma.workspace.findFirst({ where: { id: dto.workspaceId, organizationId: auth.organizationId } })
      : await this.prisma.workspace.findFirst({ where: { organizationId: auth.organizationId, isDefault: true } });
    if (!ws) throw new BadRequestException('워크스페이스를 찾을 수 없습니다.');
    const member = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId: auth.userId } } });
    if (!member || member.role === 'VIEWER') throw new ForbiddenException('이 워크스페이스에 데이터베이스를 만들 권한이 없습니다.');
    return this.prisma.$transaction(async (tx) => {
      const db = await tx.database.create({
        data: {
          organizationId: auth.organizationId,
          workspaceId: ws.id,
          name: dto.name,
          description: dto.description,
          icon: dto.icon,
          createdById: auth.userId,
        },
      });
      await tx.databaseProperty.create({ data: { databaseId: db.id, name: '이름', type: 'TITLE', isPrimary: true, position: 0 } });
      await tx.databaseView.create({ data: { databaseId: db.id, name: '표', type: 'TABLE', position: 0, config: {} } });
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.DATABASE, entityId: db.id, action: 'database.created', actorId: auth.userId, changes: { name: dto.name } }, tx);
      await this.audit.forUser(auth, 'database.created', { entityType: 'database', entityId: db.id }, tx);
      return db;
    });
  }

  async get(auth: AuthContext, id: string) {
    const db = await this.requireDb(auth, id, 'view');
    const [properties, views, rowCount, canEdit, workspace] = await Promise.all([
      this.properties(id),
      this.listViews(auth, id, true),
      this.prisma.databaseRow.count({ where: { databaseId: id, deletedAt: null } }),
      this.entityAccess.can(auth, 'DATABASE', id, 'edit'),
      this.prisma.workspace.findUnique({ where: { id: db.workspaceId }, select: { id: true, name: true } }),
    ]);
    return { ...db, workspace, properties, views, rowCount, access: { canEdit } };
  }

  async update(auth: AuthContext, id: string, dto: UpdateDatabaseDto) {
    const before = await this.requireDb(auth, id, 'edit');
    const data = { name: dto.name, description: dto.description, icon: dto.icon };
    const changes = ActivityService.diff(before as unknown as Record<string, unknown>, data);
    const updated = await this.prisma.database.update({ where: { id }, data });
    if (Object.keys(changes).length) {
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.DATABASE, entityId: id, action: 'database.updated', actorId: auth.userId, changes });
    }
    return updated;
  }

  async remove(auth: AuthContext, id: string) {
    await this.requireDb(auth, id, 'edit');
    await this.prisma.database.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.DATABASE, entityId: id, action: 'database.deleted', actorId: auth.userId });
    await this.audit.forUser(auth, 'database.deleted', { entityType: 'database', entityId: id });
    return { ok: true };
  }

  activityLog(auth: AuthContext, id: string) {
    return this.requireDb(auth, id, 'view').then(() => this.activity.list(auth.organizationId, EntityType.DATABASE, id));
  }

  // ───────────── Properties ─────────────
  private async assertRelationTarget(auth: AuthContext, config: PropertyConfig) {
    if (!config.targetDatabaseId) return;
    const target = await this.prisma.database.findFirst({ where: { id: config.targetDatabaseId, organizationId: auth.organizationId, deletedAt: null } });
    if (!target || !(await this.entityAccess.can(auth, 'DATABASE', target.id, 'view'))) {
      throw new BadRequestException('config.targetDatabaseId: 같은 조직의 접근 가능한 데이터베이스만 연결할 수 있습니다.');
    }
  }

  async createProperty(auth: AuthContext, databaseId: string, dto: CreatePropertyDto) {
    await this.requireDb(auth, databaseId, 'edit');
    assertSupportedType(dto.type);
    if (dto.type === 'TITLE') throw new BadRequestException('제목(TITLE) 속성은 데이터베이스당 하나만 존재할 수 있습니다.');
    const config = normalizeConfig(dto.type, dto.config);
    await this.assertRelationTarget(auth, config);
    const name = dto.name.trim();
    const dup = await this.prisma.databaseProperty.count({ where: { databaseId, name } });
    if (dup) throw new BadRequestException('같은 이름의 속성이 이미 있습니다.');
    const max = await this.prisma.databaseProperty.aggregate({ where: { databaseId }, _max: { position: true } });
    const prop = await this.prisma.databaseProperty.create({
      data: { databaseId, name, type: dto.type, config: json(config), position: dto.position ?? (max._max.position ?? 0) + 1 },
    });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.DATABASE, entityId: databaseId, action: 'property.created', actorId: auth.userId, changes: { name, type: dto.type } });
    return prop;
  }

  /**
   * 속성 수정. 타입 변경 시 트랜잭션 안에서 기존 셀을 새 타입으로 변환하고,
   * 변환할 수 없는 셀은 지운다. 선택 옵션 삭제 시 해당 옵션을 참조하는 셀도 정리한다.
   */
  async updateProperty(auth: AuthContext, databaseId: string, propertyId: string, dto: UpdatePropertyDto) {
    await this.requireDb(auth, databaseId, 'edit');
    const prop = await this.prisma.databaseProperty.findFirst({ where: { id: propertyId, databaseId } });
    if (!prop) throw new NotFoundException('속성을 찾을 수 없습니다.');
    const typeChanged = !!dto.type && dto.type !== prop.type;
    if (typeChanged) {
      if (prop.type === 'TITLE') throw new BadRequestException('제목(TITLE) 속성의 타입은 변경할 수 없습니다.');
      if (dto.type === 'TITLE') throw new BadRequestException('제목(TITLE) 속성은 데이터베이스당 하나만 존재할 수 있습니다.');
      assertSupportedType(dto.type!);
    }
    const newType = dto.type ?? prop.type;
    const prevConfig = cfg(prop);
    let newConfig: PropertyConfig;
    if (dto.config !== undefined) newConfig = normalizeConfig(newType, dto.config);
    else if (typeChanged) {
      // SELECT ↔ MULTI_SELECT 는 옵션 유지, 그 외에는 기본 설정
      const carry = (['SELECT', 'MULTI_SELECT'] as DbPropertyType[]).includes(newType) && prevConfig.options ? { options: prevConfig.options } : {};
      newConfig = normalizeConfig(newType, carry as Record<string, unknown>);
    } else newConfig = prevConfig;
    await this.assertRelationTarget(auth, newConfig);
    if (dto.name && dto.name.trim() !== prop.name) {
      const dup = await this.prisma.databaseProperty.count({ where: { databaseId, name: dto.name.trim(), id: { not: propertyId } } });
      if (dup) throw new BadRequestException('같은 이름의 속성이 이미 있습니다.');
    }

    return this.prisma.$transaction(async (tx) => {
      let converted = 0;
      let cleared = 0;
      const cells = await tx.databaseCell.findMany({ where: { propertyId } });
      if (typeChanged) {
        const options = [...(newConfig.options ?? [])];
        const ensureOption = (name: string) => {
          const n = name.trim().slice(0, 100);
          if (!n) return undefined;
          const found = options.find((o) => o.name === n);
          if (found) return found.id;
          if (options.length >= 200) return undefined;
          const id = Math.random().toString(36).slice(2, 10);
          options.push({ id, name: n, color: 'gray' });
          return id;
        };
        for (const cell of cells) {
          const next = REF_TYPES.includes(prop.type) ? undefined : convertValue(cell.value, prop, { type: newType, config: newConfig }, ensureOption);
          if (next === undefined) {
            await tx.databaseCell.delete({ where: { id: cell.id } });
            cleared += 1;
          } else {
            await tx.databaseCell.update({ where: { id: cell.id }, data: { value: next } });
            converted += 1;
          }
        }
        if (newType === 'SELECT' || newType === 'MULTI_SELECT') newConfig = { ...newConfig, options };
      } else if (dto.config !== undefined) {
        if (newType === 'SELECT' || newType === 'MULTI_SELECT') {
          const valid = new Set((newConfig.options ?? []).map((o) => o.id));
          for (const cell of cells) {
            if (newType === 'SELECT' && !valid.has(cell.value as string)) {
              await tx.databaseCell.delete({ where: { id: cell.id } });
              cleared += 1;
            } else if (newType === 'MULTI_SELECT' && Array.isArray(cell.value)) {
              const kept = (cell.value as string[]).filter((v) => valid.has(v));
              if (kept.length === 0) {
                await tx.databaseCell.delete({ where: { id: cell.id } });
                cleared += 1;
              } else if (kept.length !== (cell.value as string[]).length) {
                await tx.databaseCell.update({ where: { id: cell.id }, data: { value: kept } });
                converted += 1;
              }
            }
          }
        } else if (newType === 'RELATION' && newConfig.targetDatabaseId !== prevConfig.targetDatabaseId) {
          cleared = (await tx.databaseCell.deleteMany({ where: { propertyId } })).count;
        }
      }
      const updated = await tx.databaseProperty.update({
        where: { id: propertyId },
        data: { name: dto.name?.trim(), type: newType, config: json(newConfig), position: dto.position },
      });
      await this.activity.record({
        organizationId: auth.organizationId, entityType: EntityType.DATABASE, entityId: databaseId, action: 'property.updated', actorId: auth.userId,
        changes: { propertyId, name: updated.name, ...(typeChanged ? { type: { from: prop.type, to: newType }, converted, cleared } : {}) },
      }, tx);
      return { ...updated, converted, cleared };
    });
  }

  async removeProperty(auth: AuthContext, databaseId: string, propertyId: string) {
    await this.requireDb(auth, databaseId, 'edit');
    const prop = await this.prisma.databaseProperty.findFirst({ where: { id: propertyId, databaseId } });
    if (!prop) throw new NotFoundException('속성을 찾을 수 없습니다.');
    if (prop.type === 'TITLE') throw new BadRequestException('제목(TITLE) 속성은 삭제할 수 없습니다.');
    await this.prisma.databaseProperty.delete({ where: { id: propertyId } });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.DATABASE, entityId: databaseId, action: 'property.deleted', actorId: auth.userId, changes: { name: prop.name, type: prop.type } });
    return { ok: true };
  }

  async reorderProperties(auth: AuthContext, databaseId: string, orderedIds: string[]) {
    await this.requireDb(auth, databaseId, 'edit');
    const props = await this.properties(databaseId);
    const ids = new Set(props.map((p) => p.id));
    if (orderedIds.some((id) => !ids.has(id))) throw new BadRequestException('이 데이터베이스의 속성이 아닌 항목이 포함되어 있습니다.');
    await this.prisma.$transaction(orderedIds.map((id, i) => this.prisma.databaseProperty.update({ where: { id }, data: { position: i } })));
    return this.properties(databaseId);
  }

  // ───────────── Views ─────────────
  async listViews(auth: AuthContext, databaseId: string, skipCheck = false) {
    if (!skipCheck) await this.requireDb(auth, databaseId, 'view');
    const [views, props] = await Promise.all([
      this.prisma.databaseView.findMany({
        where: { databaseId, OR: [{ ownerId: null }, { ownerId: auth.userId }] },
        include: { preferences: { where: { userId: auth.userId }, select: { config: true, updatedAt: true } } },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.properties(databaseId),
    ]);
    return views.map(({ preferences, ...v }) => ({
      ...v,
      config: sanitizeViewConfig(v.config, props),
      personal: v.ownerId !== null,
      preference: preferences[0] ? sanitizeViewConfig(preferences[0].config, props) : null,
    }));
  }

  private async requireView(auth: AuthContext, databaseId: string, viewId: string, need: 'view' | 'edit') {
    const view = await this.prisma.databaseView.findFirst({ where: { id: viewId, databaseId, OR: [{ ownerId: null }, { ownerId: auth.userId }] } });
    if (!view) throw new NotFoundException('뷰를 찾을 수 없습니다.');
    if (need === 'edit' && view.ownerId === null) await this.requireDb(auth, databaseId, 'edit');
    return view;
  }

  private defaultViewConfig(type: CreateViewDto['type'], props: DatabaseProperty[]) {
    if (type === 'BOARD') {
      const sel = props.find((p) => p.type === 'SELECT');
      return sel ? { groupBy: sel.id } : {};
    }
    if (type === 'CALENDAR' || type === 'TIMELINE') {
      const date = props.find((p) => p.type === 'DATE');
      return date ? { datePropertyId: date.id } : {};
    }
    return {};
  }

  async createView(auth: AuthContext, databaseId: string, dto: CreateViewDto) {
    await this.requireDb(auth, databaseId, dto.personal ? 'view' : 'edit');
    const props = await this.properties(databaseId);
    const config = dto.config ? validateViewConfig(dto.config, props, dto.type) : this.defaultViewConfig(dto.type, props);
    const max = await this.prisma.databaseView.aggregate({ where: { databaseId }, _max: { position: true } });
    const view = await this.prisma.databaseView.create({
      data: { databaseId, name: dto.name, type: dto.type, config: json(config), ownerId: dto.personal ? auth.userId : null, position: (max._max.position ?? 0) + 1 },
    });
    return { ...view, personal: !!dto.personal, preference: null };
  }

  async updateView(auth: AuthContext, databaseId: string, viewId: string, dto: UpdateViewDto) {
    await this.requireDb(auth, databaseId, 'view');
    const view = await this.requireView(auth, databaseId, viewId, 'edit');
    const props = await this.properties(databaseId);
    const config = dto.config !== undefined ? validateViewConfig(dto.config, props, dto.type ?? view.type) : undefined;
    const updated = await this.prisma.databaseView.update({
      where: { id: viewId },
      data: { name: dto.name, type: dto.type, position: dto.position, config: config !== undefined ? json(config) : undefined },
    });
    return { ...updated, personal: updated.ownerId !== null };
  }

  async removeView(auth: AuthContext, databaseId: string, viewId: string) {
    await this.requireDb(auth, databaseId, 'view');
    const view = await this.requireView(auth, databaseId, viewId, 'edit');
    if (view.ownerId === null) {
      const shared = await this.prisma.databaseView.count({ where: { databaseId, ownerId: null } });
      if (shared <= 1) throw new BadRequestException('마지막 공유 뷰는 삭제할 수 없습니다.');
    }
    await this.prisma.databaseView.delete({ where: { id: viewId } });
    return { ok: true };
  }

  /** 사용자별 뷰 설정 (공유 뷰 위에 덮어쓰는 개인 필터/정렬/열 너비) */
  async upsertPreference(auth: AuthContext, databaseId: string, viewId: string, dto: ViewPreferenceDto) {
    await this.requireDb(auth, databaseId, 'view');
    const view = await this.requireView(auth, databaseId, viewId, 'view');
    const props = await this.properties(databaseId);
    const config = json(validateViewConfig(dto.config, props, view.type));
    return this.prisma.databaseViewPreference.upsert({
      where: { viewId_userId: { viewId, userId: auth.userId } },
      create: { viewId, userId: auth.userId, config },
      update: { config },
    });
  }

  async clearPreference(auth: AuthContext, databaseId: string, viewId: string) {
    await this.requireDb(auth, databaseId, 'view');
    await this.requireView(auth, databaseId, viewId, 'view');
    await this.prisma.databaseViewPreference.deleteMany({ where: { viewId, userId: auth.userId } });
    return { ok: true };
  }
}
