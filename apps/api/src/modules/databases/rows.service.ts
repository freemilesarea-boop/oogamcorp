import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Database, DatabaseProperty, EntityType, Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';
import { ActivityService } from '../../common/activity/activity.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntityAccessService } from '../access/entity-access.service';
import { protectCell, toCsvLine, unprotectCell } from './csv';
import { DatabasesService } from './databases.service';
import { CreateRowDto, RowQueryDto, UpdateRowDto } from './dto/database.dto';
import {
  applyFilters, applySorts, GROUPABLE, groupCounts, parseJsonParam, sanitizeViewConfig, validateFilter, validateSort, type Filter, type RowLike, type Sort, type ViewConfig,
} from './query';
import {
  CellError, cfg, displayText, emptyRefs, normalizeConfig, normalizeCell, parseBool, parseDateText, type CellRefs, type DisplayCtx, type PropLike,
} from './schema';

const MAX_IMPORT_ROWS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ImportError { row: number; column?: string; message: string }

@Injectable()
export class RowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dbs: DatabasesService,
    private readonly entityAccess: EntityAccessService,
    private readonly activity: ActivityService,
  ) {}

  // ───────────── 내부 유틸 ─────────────
  private async loadRows(databaseId: string): Promise<RowLike[]> {
    const rows = await this.prisma.databaseRow.findMany({
      where: { databaseId, deletedAt: null },
      include: { cells: { select: { propertyId: true, value: true } } },
      orderBy: { position: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      position: r.position,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      createdById: r.createdById,
      cells: Object.fromEntries(r.cells.map((c) => [c.propertyId, c.value])),
    }));
  }

  private present(r: RowLike & { createdById?: string }) {
    return { id: r.id, position: r.position, createdAt: r.createdAt, updatedAt: r.updatedAt, createdById: r.createdById, cells: r.cells };
  }

  /** 참조형 셀 값의 실제 존재·조직 소속 확인 (일괄) */
  private async assertRefs(auth: AuthContext, refs: CellRefs, fieldFor: (kind: 'users' | 'files' | 'rows') => string) {
    if (refs.users.size) {
      const ids = [...refs.users];
      const ok = await this.prisma.membership.count({ where: { organizationId: auth.organizationId, userId: { in: ids } } });
      if (ok !== ids.length) throw this.fieldError(fieldFor('users'), '조직에 속하지 않은 사용자가 포함되어 있습니다.');
    }
    if (refs.files.size) {
      const ids = [...refs.files];
      const ok = await this.prisma.file.count({ where: { organizationId: auth.organizationId, id: { in: ids }, deletedAt: null } });
      if (ok !== ids.length) throw this.fieldError(fieldFor('files'), '존재하지 않거나 접근할 수 없는 파일이 포함되어 있습니다.');
    }
    for (const [targetDbId, set] of refs.rows) {
      const ids = [...set];
      const target = await this.prisma.database.findFirst({ where: { id: targetDbId, organizationId: auth.organizationId, deletedAt: null } });
      if (!target) throw this.fieldError(fieldFor('rows'), '관계 대상 데이터베이스를 찾을 수 없습니다.');
      const ok = await this.prisma.databaseRow.count({ where: { databaseId: targetDbId, id: { in: ids }, deletedAt: null } });
      if (ok !== ids.length) throw this.fieldError(fieldFor('rows'), '관계 대상 데이터베이스에 없는 행이 포함되어 있습니다.');
    }
  }

  private fieldError(field: string, message: string) {
    return new BadRequestException({ statusCode: 400, error: 'Bad Request', message: `${field}: ${message}`, field });
  }

  /** 셀 입력 검증 → { propertyId: 정규화 값|null } */
  private async validateCells(auth: AuthContext, props: DatabaseProperty[], input: Record<string, unknown>) {
    const byId = new Map(props.map((p) => [p.id, p]));
    const refs = emptyRefs();
    const out = new Map<string, Prisma.InputJsonValue | null>();
    const refField: Record<'users' | 'files' | 'rows', string> = { users: '', files: '', rows: '' };
    if (Object.keys(input).length > 200) throw new BadRequestException('cells: 한 번에 최대 200개 속성까지 수정할 수 있습니다.');
    for (const [pid, raw] of Object.entries(input)) {
      const prop = byId.get(pid);
      if (!prop) throw this.fieldError(`cells.${pid}`, '이 데이터베이스에 없는 속성입니다.');
      try {
        out.set(pid, normalizeCell(prop, raw, refs));
      } catch (e) {
        if (e instanceof CellError) throw this.fieldError(e.field, e.message);
        throw e;
      }
      if (prop.type === 'PERSON') refField.users = prop.name;
      if (prop.type === 'FILE') refField.files = prop.name;
      if (prop.type === 'RELATION') refField.rows = prop.name;
    }
    await this.assertRefs(auth, refs, (k) => refField[k]);
    return out;
  }

  private async writeCells(tx: Prisma.TransactionClient, rowId: string, values: Map<string, Prisma.InputJsonValue | null>) {
    for (const [propertyId, value] of values) {
      if (value === null) await tx.databaseCell.deleteMany({ where: { rowId, propertyId } });
      else {
        await tx.databaseCell.upsert({
          where: { rowId_propertyId: { rowId, propertyId } },
          create: { rowId, propertyId, value },
          update: { value },
        });
      }
    }
  }

  private async requireRow(databaseId: string, rowId: string) {
    const row = await this.prisma.databaseRow.findFirst({
      where: { id: rowId, databaseId, deletedAt: null },
      include: { cells: { select: { propertyId: true, value: true } } },
    });
    if (!row) throw new NotFoundException('행을 찾을 수 없습니다.');
    return row;
  }

  private titleOf(props: DatabaseProperty[], cells: Record<string, unknown>) {
    const t = props.find((p) => p.type === 'TITLE');
    return t ? String(cells[t.id] ?? '') : '';
  }

  // ───────────── 조회 ─────────────
  /** 뷰 설정 + 개인 설정 + 요청 파라미터 순으로 덮어쓴 유효 설정 */
  private async effectiveConfig(auth: AuthContext, databaseId: string, props: DatabaseProperty[], q: { viewId?: string; filters?: string; sorts?: string; filterMode?: 'and' | 'or'; groupBy?: string }): Promise<ViewConfig> {
    let config: ViewConfig = {};
    if (q.viewId) {
      const view = await this.prisma.databaseView.findFirst({
        where: { id: q.viewId, databaseId, OR: [{ ownerId: null }, { ownerId: auth.userId }] },
        include: { preferences: { where: { userId: auth.userId } } },
      });
      if (!view) throw new NotFoundException('뷰를 찾을 수 없습니다.');
      config = sanitizeViewConfig(view.config, props);
      if (view.preferences[0]) {
        const pref = sanitizeViewConfig(view.preferences[0].config, props);
        config = { ...config, ...Object.fromEntries(Object.entries(pref).filter(([, v]) => v !== undefined && v !== null)) };
      }
    }
    const map = new Map<string, PropLike>(props.map((p) => [p.id, p]));
    const filters = parseJsonParam(q.filters, 'filters');
    if (filters) config.filters = filters.map((f, i) => validateFilter(f, map, `filters[${i}]`));
    const sorts = parseJsonParam(q.sorts, 'sorts');
    if (sorts) config.sorts = sorts.map((s, i) => validateSort(s, map, `sorts[${i}]`));
    if (q.filterMode) config.filterMode = q.filterMode;
    if (q.groupBy) {
      const p = map.get(q.groupBy);
      if (!p || !GROUPABLE.includes(p.type)) throw new BadRequestException('groupBy: 선택/사람/체크박스 속성만 그룹 기준이 될 수 있습니다.');
      config.groupBy = p.id;
    }
    return config;
  }

  private async queryRows(auth: AuthContext, db: Database, props: DatabaseProperty[], config: ViewConfig, text?: string) {
    const map = new Map<string, PropLike>(props.map((p) => [p.id, p]));
    let rows = await this.loadRows(db.id);
    if (text) {
      const t = props.find((p) => p.type === 'TITLE');
      const needle = text.toLowerCase();
      rows = rows.filter((r) => t && String(r.cells[t.id] ?? '').toLowerCase().includes(needle));
    }
    // PERSON 필터의 "me" 는 현재 사용자로 치환
    const filters: Filter[] = (config.filters ?? []).map((f) => (map.get(f.propertyId)?.type === 'PERSON' && f.value === 'me' ? { ...f, value: auth.userId } : f));
    rows = applyFilters(rows, filters, config.filterMode ?? 'and', map);
    rows = applySorts(rows, (config.sorts ?? []) as Sort[], map);
    return rows;
  }

  async list(auth: AuthContext, databaseId: string, q: RowQueryDto) {
    const db = await this.dbs.requireDb(auth, databaseId, 'view');
    const props = await this.dbs.properties(databaseId);
    const config = await this.effectiveConfig(auth, databaseId, props, q);
    const rows = await this.queryRows(auth, db, props, config, q.q);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map((r) => this.present(r));
    const groupProp = config.groupBy ? props.find((p) => p.id === config.groupBy) : undefined;
    return {
      items,
      total: rows.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
      groupBy: groupProp?.id ?? null,
      groups: groupProp ? groupCounts(rows, groupProp) : undefined,
      config,
    };
  }

  async get(auth: AuthContext, databaseId: string, rowId: string) {
    await this.dbs.requireDb(auth, databaseId, 'view');
    const r = await this.requireRow(databaseId, rowId);
    return this.present({ ...r, cells: Object.fromEntries(r.cells.map((c) => [c.propertyId, c.value])) });
  }

  // ───────────── 변경 ─────────────
  async create(auth: AuthContext, databaseId: string, dto: CreateRowDto) {
    await this.dbs.requireDb(auth, databaseId, 'edit');
    const props = await this.dbs.properties(databaseId);
    const values = await this.validateCells(auth, props, dto.cells ?? {});
    const max = await this.prisma.databaseRow.aggregate({ where: { databaseId }, _max: { position: true } });
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.databaseRow.create({ data: { databaseId, createdById: auth.userId, position: dto.position ?? (max._max.position ?? 0) + 1024 } });
      await this.writeCells(tx, r.id, values);
      await tx.database.update({ where: { id: databaseId }, data: { updatedAt: new Date() } });
      const cells = Object.fromEntries([...values].filter(([, v]) => v !== null));
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.DATABASE_ROW, entityId: r.id, action: 'row.created', actorId: auth.userId, changes: { databaseId, title: this.titleOf(props, cells) } }, tx);
      return r;
    });
    return this.get(auth, databaseId, row.id);
  }

  async update(auth: AuthContext, databaseId: string, rowId: string, dto: UpdateRowDto) {
    await this.dbs.requireDb(auth, databaseId, 'edit');
    const row = await this.requireRow(databaseId, rowId);
    const props = await this.dbs.properties(databaseId);
    const values = await this.validateCells(auth, props, dto.cells);
    const before = Object.fromEntries(row.cells.map((c) => [c.propertyId, c.value]));
    const nameOf = new Map(props.map((p) => [p.id, p.name]));
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [pid, v] of values) {
      if (JSON.stringify(before[pid] ?? null) !== JSON.stringify(v)) changes[nameOf.get(pid)!] = { from: before[pid] ?? null, to: v };
    }
    await this.prisma.$transaction(async (tx) => {
      await this.writeCells(tx, rowId, values);
      await tx.databaseRow.update({ where: { id: rowId }, data: { updatedById: auth.userId, updatedAt: new Date() } });
      if (Object.keys(changes).length) {
        await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.DATABASE_ROW, entityId: rowId, action: 'row.updated', actorId: auth.userId, changes: { databaseId, ...changes } }, tx);
      }
    });
    return this.get(auth, databaseId, rowId);
  }

  async remove(auth: AuthContext, databaseId: string, rowId: string) {
    await this.dbs.requireDb(auth, databaseId, 'edit');
    const row = await this.requireRow(databaseId, rowId);
    const props = await this.dbs.properties(databaseId);
    await this.prisma.databaseRow.update({ where: { id: rowId }, data: { deletedAt: new Date(), updatedById: auth.userId } });
    await this.activity.record({
      organizationId: auth.organizationId, entityType: EntityType.DATABASE_ROW, entityId: rowId, action: 'row.deleted', actorId: auth.userId,
      changes: { databaseId, title: this.titleOf(props, Object.fromEntries(row.cells.map((c) => [c.propertyId, c.value]))) },
    });
    return { ok: true };
  }

  /** 일괄 순서 변경: orderedIds 순서대로 position 재부여 */
  async reorder(auth: AuthContext, databaseId: string, orderedIds: string[]) {
    await this.dbs.requireDb(auth, databaseId, 'edit');
    const unique = [...new Set(orderedIds)];
    const count = await this.prisma.databaseRow.count({ where: { databaseId, id: { in: unique }, deletedAt: null } });
    if (count !== unique.length) throw new BadRequestException('이 데이터베이스의 행이 아닌 항목이 포함되어 있습니다.');
    await this.prisma.$transaction(unique.map((id, i) => this.prisma.databaseRow.update({ where: { id }, data: { position: (i + 1) * 1024 } })));
    return { ok: true, count: unique.length };
  }

  async rowActivity(auth: AuthContext, databaseId: string, rowId: string) {
    await this.dbs.requireDb(auth, databaseId, 'view');
    const row = await this.prisma.databaseRow.findFirst({ where: { id: rowId, databaseId } });
    if (!row) throw new NotFoundException('행을 찾을 수 없습니다.');
    const logs = await this.activity.list(auth.organizationId, EntityType.DATABASE_ROW, rowId);
    const actorIds = [...new Set(logs.map((l) => l.actorId).filter(Boolean))] as string[];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return logs.map((l) => ({ ...l, actor: l.actorId ? byId.get(l.actorId) ?? null : null }));
  }

  // ───────────── CSV ─────────────
  async exportCsv(auth: AuthContext, databaseId: string, viewId?: string): Promise<{ filename: string; body: string }> {
    const db = await this.dbs.requireDb(auth, databaseId, 'view');
    const props = await this.dbs.properties(databaseId);
    const config = viewId ? await this.effectiveConfig(auth, databaseId, props, { viewId }) : {};
    const rows = await this.queryRows(auth, db, props, config);
    const ctx = await this.displayContext(auth, props, rows);
    const lines = [toCsvLine(props.map((p) => protectCell(p.name)))];
    for (const r of rows) {
      lines.push(toCsvLine(props.map((p) => protectCell(displayText(p, r.cells[p.id], ctx), p.type === 'NUMBER'))));
    }
    // BOM: 엑셀에서 한글 깨짐 방지
    return { filename: `${db.name}.csv`, body: '﻿' + lines.join('\r\n') + '\r\n' };
  }

  private async displayContext(auth: AuthContext, props: DatabaseProperty[], rows: RowLike[]): Promise<DisplayCtx> {
    const userIds = new Set<string>();
    const fileIds = new Set<string>();
    const relRows = new Map<string, Set<string>>();
    for (const p of props) {
      for (const r of rows) {
        const v = r.cells[p.id];
        if (!Array.isArray(v)) continue;
        if (p.type === 'PERSON') v.forEach((id) => userIds.add(id as string));
        if (p.type === 'FILE') v.forEach((id) => fileIds.add(id as string));
        if (p.type === 'RELATION' && cfg(p).targetDatabaseId) {
          const s = relRows.get(cfg(p).targetDatabaseId!) ?? new Set<string>();
          v.forEach((id) => s.add(id as string));
          relRows.set(cfg(p).targetDatabaseId!, s);
        }
      }
    }
    const users = await this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true, email: true } });
    const files = await this.prisma.file.findMany({ where: { id: { in: [...fileIds] }, organizationId: auth.organizationId }, select: { id: true, originalName: true } });
    const rowTitles = new Map<string, string>();
    for (const [dbId, ids] of relRows) {
      // 대상 DB 열람 권한이 없으면 제목을 노출하지 않는다
      if (!(await this.entityAccess.can(auth, 'DATABASE', dbId, 'view'))) continue;
      const titleProp = await this.prisma.databaseProperty.findFirst({ where: { databaseId: dbId, type: 'TITLE' } });
      if (!titleProp) continue;
      const cells = await this.prisma.databaseCell.findMany({ where: { propertyId: titleProp.id, rowId: { in: [...ids] } }, select: { rowId: true, value: true } });
      cells.forEach((c) => rowTitles.set(c.rowId, String(c.value)));
    }
    return {
      users: new Map(users.map((u) => [u.id, u])),
      files: new Map(files.map((f) => [f.id, f.originalName])),
      rowTitles,
    };
  }

  /**
   * CSV 가져오기. 첫 행은 헤더(속성 이름). 각 셀은 속성 타입별로 해석·검증하며,
   * 오류가 있는 행은 건너뛰고 { row, column, message } 로 보고한다.
   */
  async importCsv(auth: AuthContext, databaseId: string, text: string, createMissing: boolean) {
    await this.dbs.requireDb(auth, databaseId, 'edit');
    if (Buffer.byteLength(text, 'utf8') > 5 * 1024 * 1024) throw new BadRequestException('CSV 는 최대 5MB 까지 가져올 수 있습니다.');
    let records: string[][];
    try {
      records = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: false }) as string[][];
    } catch (e) {
      throw new BadRequestException(`CSV 형식 오류: ${(e as Error).message}`);
    }
    if (records.length === 0) throw new BadRequestException('CSV 에 헤더 행이 없습니다.');
    if (records.length - 1 > MAX_IMPORT_ROWS) throw new BadRequestException(`한 번에 최대 ${MAX_IMPORT_ROWS.toLocaleString()}행까지 가져올 수 있습니다.`);
    const header = records[0].map((h) => unprotectCell(h).trim());
    const errors: ImportError[] = [];
    let props = await this.dbs.properties(databaseId);
    const createdProperties: string[] = [];

    // 헤더 → 속성 매핑 (없으면 옵션에 따라 TEXT 속성 생성)
    const columns: (DatabaseProperty | null)[] = [];
    const seen = new Set<string>();
    for (const name of header) {
      if (!name || seen.has(name)) {
        columns.push(null);
        if (name) errors.push({ row: 1, column: name, message: '중복된 열 이름입니다(무시됨).' });
        continue;
      }
      seen.add(name);
      let prop = props.find((p) => p.name === name) ?? props.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (!prop && createMissing) {
        if (name.length > 100) {
          errors.push({ row: 1, column: name, message: '속성 이름은 100자 이하여야 합니다(무시됨).' });
          columns.push(null);
          continue;
        }
        const max = props.reduce((m, p) => Math.max(m, p.position), 0);
        prop = await this.prisma.databaseProperty.create({ data: { databaseId, name, type: 'TEXT', config: {}, position: max + 1 } });
        props = [...props, prop];
        createdProperties.push(name);
      }
      if (!prop) errors.push({ row: 1, column: name, message: '존재하지 않는 속성입니다(무시됨). "없는 속성 생성" 옵션을 사용할 수 있습니다.' });
      columns.push(prop ?? null);
    }

    // 선택 옵션 자동 추가를 위한 가변 설정
    const optionConfigs = new Map<string, { id: string; name: string; color: string }[]>();
    for (const p of props) if (p.type === 'SELECT' || p.type === 'MULTI_SELECT') optionConfigs.set(p.id, [...(cfg(p).options ?? [])]);
    const ensureOption = (pid: string, name: string): string | null => {
      const opts = optionConfigs.get(pid)!;
      const n = name.trim().slice(0, 100);
      const found = opts.find((o) => o.name === n);
      if (found) return found.id;
      if (opts.length >= 200) return null;
      const id = Math.random().toString(36).slice(2, 10);
      opts.push({ id, name: n, color: 'gray' });
      return id;
    };

    // 사람(이메일) / 관계(제목) 해석용 조회
    const members = await this.prisma.membership.findMany({ where: { organizationId: auth.organizationId }, select: { userId: true, user: { select: { email: true } } } });
    const userByEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.userId]));
    const memberIds = new Set(members.map((m) => m.userId));
    const relationTitles = new Map<string, Map<string, string[]>>();
    for (const p of props) {
      const target = cfg(p).targetDatabaseId;
      if (p.type !== 'RELATION' || !target || relationTitles.has(target)) continue;
      const tp = await this.prisma.databaseProperty.findFirst({ where: { databaseId: target, type: 'TITLE' } });
      const cells = tp ? await this.prisma.databaseCell.findMany({ where: { propertyId: tp.id, row: { deletedAt: null } }, select: { rowId: true, value: true } }) : [];
      const m = new Map<string, string[]>();
      cells.forEach((c) => m.set(String(c.value), [...(m.get(String(c.value)) ?? []), c.rowId]));
      relationTitles.set(target, m);
    }

    const toRaw = (p: DatabaseProperty, s: string): unknown => {
      const v = unprotectCell(s);
      const t = v.trim();
      if (t === '') return null;
      switch (p.type) {
        case 'TITLE':
        case 'TEXT':
        case 'URL':
          return p.type === 'URL' ? t : v;
        case 'NUMBER': {
          const n = Number(t.replace(/,/g, ''));
          if (!Number.isFinite(n)) throw new CellError(p.name, `숫자가 아닙니다: "${t.slice(0, 50)}"`);
          return n;
        }
        case 'CHECKBOX': {
          const b = parseBool(t);
          if (b === undefined) throw new CellError(p.name, `true/false 로 해석할 수 없습니다: "${t.slice(0, 50)}"`);
          return b;
        }
        case 'DATE': {
          const d = parseDateText(t);
          if (!d) throw new CellError(p.name, `날짜 형식(YYYY-MM-DD 또는 시작 ~ 종료)이 아닙니다: "${t.slice(0, 50)}"`);
          return d;
        }
        case 'SELECT': {
          const id = ensureOption(p.id, t);
          if (!id) throw new CellError(p.name, '선택 옵션은 최대 200개입니다.');
          return id;
        }
        case 'MULTI_SELECT':
          return t.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
            const id = ensureOption(p.id, x);
            if (!id) throw new CellError(p.name, '선택 옵션은 최대 200개입니다.');
            return id;
          });
        case 'PERSON':
          return t.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
            const id = UUID_RE.test(x) && memberIds.has(x) ? x : userByEmail.get(x.toLowerCase());
            if (!id) throw new CellError(p.name, `조직 구성원을 찾을 수 없습니다: "${x.slice(0, 80)}"`);
            return id;
          });
        case 'RELATION': {
          const titles = relationTitles.get(cfg(p).targetDatabaseId ?? '') ?? new Map<string, string[]>();
          return t.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
            if (UUID_RE.test(x)) return x;
            const ids = titles.get(x);
            if (!ids?.length) throw new CellError(p.name, `관계 대상에서 "${x.slice(0, 80)}" 행을 찾을 수 없습니다.`);
            if (ids.length > 1) throw new CellError(p.name, `관계 대상에 "${x.slice(0, 80)}" 제목의 행이 여러 개입니다.`);
            return ids[0];
          });
        }
        case 'FILE':
          throw new CellError(p.name, '파일 속성은 CSV 로 가져올 수 없습니다.');
        default:
          throw new CellError(p.name, `${p.type} 속성은 가져올 수 없습니다.`);
      }
    };

    const prepared: { line: number; values: Map<string, Prisma.InputJsonValue> }[] = [];
    for (let i = 1; i < records.length; i++) {
      const line = i + 1;
      const rec = records[i];
      const values = new Map<string, Prisma.InputJsonValue>();
      let failed = false;
      for (let c = 0; c < columns.length; c++) {
        const prop = columns[c];
        if (!prop) continue;
        try {
          const raw = toRaw(prop, rec[c] ?? '');
          // 옵션이 추가되었을 수 있으므로 최신 옵션으로 검증
          const live = optionConfigs.has(prop.id) ? { ...prop, config: { ...cfg(prop), options: optionConfigs.get(prop.id) } } : prop;
          const refs = emptyRefs();
          const norm = normalizeCell(live, raw, refs);
          if (refs.files.size) throw new CellError(prop.name, '파일 속성은 CSV 로 가져올 수 없습니다.');
          for (const [target, ids] of refs.rows) {
            const ok = await this.prisma.databaseRow.count({ where: { databaseId: target, id: { in: [...ids] }, deletedAt: null, database: { organizationId: auth.organizationId } } });
            if (ok !== ids.size) throw new CellError(prop.name, '관계 대상 데이터베이스에 없는 행이 포함되어 있습니다.');
          }
          if (norm !== null) values.set(prop.id, norm);
        } catch (e) {
          if (!(e instanceof CellError)) throw e;
          failed = true;
          if (errors.length < 500) errors.push({ row: line, column: prop.name, message: e.message });
        }
      }
      if (!failed) prepared.push({ line, values });
    }

    const max = await this.prisma.databaseRow.aggregate({ where: { databaseId }, _max: { position: true } });
    let pos = max._max.position ?? 0;
    await this.prisma.$transaction(async (tx) => {
      // 자동 추가된 선택 옵션 저장
      for (const p of props) {
        const opts = optionConfigs.get(p.id);
        if (opts && opts.length !== (cfg(p).options ?? []).length) {
          await tx.databaseProperty.update({ where: { id: p.id }, data: { config: normalizeConfig(p.type, { ...cfg(p), options: opts }) as Prisma.InputJsonValue } });
        }
      }
      const rowData = prepared.map(() => ({ id: randomUUID(), databaseId, createdById: auth.userId, position: (pos += 1024) }));
      for (let i = 0; i < rowData.length; i += 1000) await tx.databaseRow.createMany({ data: rowData.slice(i, i + 1000) });
      const cellData = prepared.flatMap((p, i) => [...p.values].map(([propertyId, value]) => ({ rowId: rowData[i].id, propertyId, value })));
      for (let i = 0; i < cellData.length; i += 2000) await tx.databaseCell.createMany({ data: cellData.slice(i, i + 2000) });
      await tx.database.update({ where: { id: databaseId }, data: { updatedAt: new Date() } });
      await this.activity.record({
        organizationId: auth.organizationId, entityType: EntityType.DATABASE, entityId: databaseId, action: 'rows.imported', actorId: auth.userId,
        changes: { imported: prepared.length, failed: records.length - 1 - prepared.length, createdProperties },
      }, tx);
    }, { timeout: 60_000 });

    return { imported: prepared.length, failedRows: records.length - 1 - prepared.length, createdProperties, errors };
  }
}
