import { BadRequestException } from '@nestjs/common';
import type { DbPropertyType, DbViewType } from '@prisma/client';
import { isIsoDate, type PropLike } from './schema';

/**
 * 행 필터/정렬/그룹 엔진 + 뷰 설정 검증.
 * 현재는 DB 단위로 행을 읽어 서버 메모리에서 평가한다(데이터베이스당 수천 행 규모 전제).
 * 대규모 확장 시 동일 연산자를 JSONB 조건(SQL)으로 컴파일하도록 교체한다.
 */

export const OPERATORS: Record<string, string[]> = {
  TITLE: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'],
  TEXT: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'],
  URL: ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty'],
  NUMBER: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  SELECT: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  MULTI_SELECT: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  PERSON: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  RELATION: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  FILE: ['is_empty', 'is_not_empty'],
  CHECKBOX: ['is_checked', 'is_not_checked'],
  DATE: ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty'],
};
const NO_VALUE = ['is_empty', 'is_not_empty', 'is_checked', 'is_not_checked'];
export const GROUPABLE: DbPropertyType[] = ['SELECT', 'PERSON', 'CHECKBOX'];
export const SYSTEM_SORT_FIELDS = ['createdAt', 'updatedAt', 'position'] as const;

export interface Filter { propertyId: string; operator: string; value?: unknown }
export interface Sort { propertyId: string; direction: 'asc' | 'desc' }
export interface ViewConfig {
  filters?: Filter[];
  filterMode?: 'and' | 'or';
  sorts?: Sort[];
  groupBy?: string | null;
  visibleProperties?: string[];
  datePropertyId?: string | null;
  propertyWidths?: Record<string, number>;
}
export interface RowLike {
  id: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  cells: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 필터 1건 검증 (속성/연산자/값 형태) */
export function validateFilter(f: unknown, props: Map<string, PropLike>, path: string): Filter {
  if (!isObj(f)) throw new BadRequestException(`${path}: 필터 형식이 올바르지 않습니다.`);
  const { propertyId, operator, value, ...rest } = f;
  if (Object.keys(rest).length) throw new BadRequestException(`${path}: 허용되지 않는 필드가 있습니다.`);
  if (typeof propertyId !== 'string' || !props.has(propertyId)) throw new BadRequestException(`${path}.propertyId: 존재하지 않는 속성입니다.`);
  const prop = props.get(propertyId)!;
  const ops = OPERATORS[prop.type] ?? [];
  if (typeof operator !== 'string' || !ops.includes(operator)) {
    throw new BadRequestException(`${path}.operator: ${prop.name}(${prop.type}) 속성은 ${ops.join(', ')} 연산자만 지원합니다.`);
  }
  if (!NO_VALUE.includes(operator)) {
    if (value === undefined || value === null || value === '') throw new BadRequestException(`${path}.value: 비교 값이 필요합니다.`);
    if (prop.type === 'NUMBER' && (typeof value !== 'number' || !Number.isFinite(value))) throw new BadRequestException(`${path}.value: 숫자여야 합니다.`);
    if (prop.type === 'DATE' && !isIsoDate(value)) throw new BadRequestException(`${path}.value: ISO 날짜여야 합니다.`);
    if (['TITLE', 'TEXT', 'URL', 'SELECT', 'MULTI_SELECT', 'PERSON', 'RELATION'].includes(prop.type) && (typeof value !== 'string' || value.length > 500)) {
      throw new BadRequestException(`${path}.value: 500자 이하 문자열이어야 합니다.`);
    }
  }
  return { propertyId, operator, ...(NO_VALUE.includes(operator) ? {} : { value }) };
}

export function validateSort(s: unknown, props: Map<string, PropLike>, path: string): Sort {
  if (!isObj(s)) throw new BadRequestException(`${path}: 정렬 형식이 올바르지 않습니다.`);
  const { propertyId, direction, ...rest } = s;
  if (Object.keys(rest).length) throw new BadRequestException(`${path}: 허용되지 않는 필드가 있습니다.`);
  const ok = typeof propertyId === 'string' && (props.has(propertyId) || (SYSTEM_SORT_FIELDS as readonly string[]).includes(propertyId));
  if (!ok) throw new BadRequestException(`${path}.propertyId: 정렬할 수 없는 속성입니다.`);
  if (direction !== 'asc' && direction !== 'desc') throw new BadRequestException(`${path}.direction: asc 또는 desc 여야 합니다.`);
  return { propertyId: propertyId as string, direction };
}

export function parseJsonParam(raw: string | undefined, name: string): unknown[] | undefined {
  if (raw === undefined || raw === '') return undefined;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new BadRequestException(`${name}: JSON 형식이 올바르지 않습니다.`);
  }
  if (!Array.isArray(v) || v.length > 30) throw new BadRequestException(`${name}: 최대 30개 항목의 배열이어야 합니다.`);
  return v;
}

/** 뷰 설정 검증 (공유 뷰/개인 설정 공통) */
export function validateViewConfig(raw: Record<string, unknown> | undefined, props: PropLike[], viewType?: DbViewType): ViewConfig {
  const c = raw ?? {};
  const map = new Map(props.map((p) => [p.id, p]));
  const allowed = ['filters', 'filterMode', 'sorts', 'groupBy', 'visibleProperties', 'datePropertyId', 'propertyWidths'];
  for (const k of Object.keys(c)) if (!allowed.includes(k)) throw new BadRequestException(`config.${k}: 지원하지 않는 뷰 설정입니다.`);
  const out: ViewConfig = {};
  if (c.filters !== undefined) {
    if (!Array.isArray(c.filters) || c.filters.length > 30) throw new BadRequestException('config.filters: 최대 30개의 배열이어야 합니다.');
    out.filters = c.filters.map((f, i) => validateFilter(f, map, `config.filters[${i}]`));
  }
  if (c.filterMode !== undefined) {
    if (c.filterMode !== 'and' && c.filterMode !== 'or') throw new BadRequestException('config.filterMode: and 또는 or 여야 합니다.');
    out.filterMode = c.filterMode;
  }
  if (c.sorts !== undefined) {
    if (!Array.isArray(c.sorts) || c.sorts.length > 10) throw new BadRequestException('config.sorts: 최대 10개의 배열이어야 합니다.');
    out.sorts = c.sorts.map((s, i) => validateSort(s, map, `config.sorts[${i}]`));
  }
  if (c.groupBy !== undefined && c.groupBy !== null) {
    const p = typeof c.groupBy === 'string' ? map.get(c.groupBy) : undefined;
    if (!p || !GROUPABLE.includes(p.type)) throw new BadRequestException('config.groupBy: 선택/사람/체크박스 속성만 그룹 기준이 될 수 있습니다.');
    out.groupBy = p.id;
  } else if (c.groupBy === null) out.groupBy = null;
  if (c.visibleProperties !== undefined) {
    if (!Array.isArray(c.visibleProperties) || c.visibleProperties.some((id) => typeof id !== 'string' || !map.has(id))) {
      throw new BadRequestException('config.visibleProperties: 존재하는 속성 ID 배열이어야 합니다.');
    }
    out.visibleProperties = [...new Set(c.visibleProperties as string[])];
  }
  if (c.datePropertyId !== undefined && c.datePropertyId !== null) {
    const p = typeof c.datePropertyId === 'string' ? map.get(c.datePropertyId) : undefined;
    if (!p || p.type !== 'DATE') throw new BadRequestException('config.datePropertyId: 날짜 속성이어야 합니다.');
    out.datePropertyId = p.id;
  } else if (c.datePropertyId === null) out.datePropertyId = null;
  if (c.propertyWidths !== undefined) {
    if (!isObj(c.propertyWidths)) throw new BadRequestException('config.propertyWidths: 객체여야 합니다.');
    const w: Record<string, number> = {};
    for (const [k, v] of Object.entries(c.propertyWidths)) {
      if (!map.has(k) || typeof v !== 'number' || v < 40 || v > 1200) throw new BadRequestException('config.propertyWidths: 속성별 40~1200 숫자여야 합니다.');
      w[k] = Math.round(v);
    }
    out.propertyWidths = w;
  }
  if (viewType === 'BOARD' && out.groupBy) {
    // 보드는 그룹 기준이 필수는 아니지만, 지정 시 그룹 가능한 속성이어야 한다 (위에서 검증)
  }
  return out;
}

/** 저장된 설정 중 삭제된 속성을 가리키는 항목 제거 (조회 시 안전하게 적용) */
export function sanitizeViewConfig(raw: unknown, props: PropLike[]): ViewConfig {
  const c = isObj(raw) ? raw : {};
  const map = new Map(props.map((p) => [p.id, p]));
  const filters = Array.isArray(c.filters) ? (c.filters as Filter[]).filter((f) => isObj(f) && map.has(f.propertyId) && (OPERATORS[map.get(f.propertyId)!.type] ?? []).includes(f.operator)) : undefined;
  const sorts = Array.isArray(c.sorts) ? (c.sorts as Sort[]).filter((s) => isObj(s) && (map.has(s.propertyId) || (SYSTEM_SORT_FIELDS as readonly string[]).includes(s.propertyId))) : undefined;
  return {
    ...(c as ViewConfig),
    filters,
    sorts,
    groupBy: typeof c.groupBy === 'string' && map.has(c.groupBy) ? c.groupBy : null,
    datePropertyId: typeof c.datePropertyId === 'string' && map.has(c.datePropertyId) ? c.datePropertyId : null,
    visibleProperties: Array.isArray(c.visibleProperties) ? (c.visibleProperties as string[]).filter((id) => map.has(id)) : undefined,
  };
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const dayOf = (s: string) => s.slice(0, 10);

function matches(row: RowLike, f: Filter, prop: PropLike): boolean {
  const v = row.cells[f.propertyId];
  switch (f.operator) {
    case 'is_empty': return isEmpty(v);
    case 'is_not_empty': return !isEmpty(v);
    case 'is_checked': return v === true;
    case 'is_not_checked': return v !== true;
  }
  if (prop.type === 'DATE') {
    const start = (v as { start?: string } | undefined)?.start;
    if (!start) return false;
    const a = Date.parse(start);
    const b = Date.parse(f.value as string);
    switch (f.operator) {
      case 'equals': return dayOf(start) === dayOf(f.value as string);
      case 'before': return a < b;
      case 'after': return a > b;
      case 'on_or_before': return a <= b || dayOf(start) === dayOf(f.value as string);
      case 'on_or_after': return a >= b || dayOf(start) === dayOf(f.value as string);
    }
    return false;
  }
  if (prop.type === 'NUMBER') {
    if (typeof v !== 'number') return f.operator === 'not_equals';
    const n = f.value as number;
    switch (f.operator) {
      case 'equals': return v === n;
      case 'not_equals': return v !== n;
      case 'gt': return v > n;
      case 'gte': return v >= n;
      case 'lt': return v < n;
      case 'lte': return v <= n;
    }
    return false;
  }
  if (Array.isArray(v) || ['MULTI_SELECT', 'PERSON', 'RELATION'].includes(prop.type)) {
    const arr = Array.isArray(v) ? v : [];
    if (f.operator === 'contains') return arr.includes(f.value);
    if (f.operator === 'not_contains') return !arr.includes(f.value);
    return false;
  }
  const s = typeof v === 'string' ? v : '';
  const q = String(f.value);
  switch (f.operator) {
    case 'equals': return prop.type === 'SELECT' ? s === q : s.toLowerCase() === q.toLowerCase();
    case 'not_equals': return prop.type === 'SELECT' ? s !== q : s.toLowerCase() !== q.toLowerCase();
    case 'contains': return s.toLowerCase().includes(q.toLowerCase());
    case 'not_contains': return !s.toLowerCase().includes(q.toLowerCase());
    case 'starts_with': return s.toLowerCase().startsWith(q.toLowerCase());
  }
  return false;
}

export function applyFilters(rows: RowLike[], filters: Filter[], mode: 'and' | 'or', props: Map<string, PropLike>): RowLike[] {
  const active = filters.filter((f) => props.has(f.propertyId));
  if (!active.length) return rows;
  return rows.filter((r) => {
    const results = active.map((f) => matches(r, f, props.get(f.propertyId)!));
    return mode === 'or' ? results.some(Boolean) : results.every(Boolean);
  });
}

function sortKey(row: RowLike, propertyId: string, props: Map<string, PropLike>): string | number | null {
  if (propertyId === 'createdAt') return row.createdAt.getTime();
  if (propertyId === 'updatedAt') return row.updatedAt.getTime();
  if (propertyId === 'position') return row.position;
  const prop = props.get(propertyId);
  const v = row.cells[propertyId];
  if (!prop || isEmpty(v)) return null;
  switch (prop.type) {
    case 'NUMBER': return v as number;
    case 'CHECKBOX': return v ? 1 : 0;
    case 'DATE': return Date.parse((v as { start: string }).start);
    case 'SELECT': {
      // 옵션 순서대로 정렬 (Notion 과 동일)
      const opts = ((prop.config as { options?: { id: string }[] })?.options ?? []);
      const i = opts.findIndex((o) => o.id === v);
      return i < 0 ? null : i;
    }
    case 'MULTI_SELECT':
    case 'PERSON':
    case 'RELATION':
    case 'FILE': return (v as unknown[]).length;
    default: return String(v).toLowerCase();
  }
}

export function applySorts(rows: RowLike[], sorts: Sort[], props: Map<string, PropLike>): RowLike[] {
  const all = [...sorts, { propertyId: 'position', direction: 'asc' as const }];
  const collator = new Intl.Collator('ko');
  return [...rows].sort((a, b) => {
    for (const s of all) {
      const x = sortKey(a, s.propertyId, props);
      const y = sortKey(b, s.propertyId, props);
      if (x === y) continue;
      // 빈 값은 항상 뒤로
      if (x === null) return 1;
      if (y === null) return -1;
      const cmp = typeof x === 'string' && typeof y === 'string' ? collator.compare(x, y) : (x as number) < (y as number) ? -1 : 1;
      if (cmp !== 0) return s.direction === 'asc' ? cmp : -cmp;
    }
    return a.id < b.id ? -1 : 1;
  });
}

/** 그룹 키별 개수. PERSON/MULTI 는 다중 소속 가능, 빈 값은 key=null */
export function groupCounts(rows: RowLike[], prop: PropLike): { key: string | null; count: number }[] {
  const counts = new Map<string | null, number>();
  const bump = (k: string | null) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const r of rows) {
    const v = r.cells[prop.id];
    if (prop.type === 'CHECKBOX') bump(v === true ? 'true' : 'false');
    else if (prop.type === 'PERSON') {
      if (Array.isArray(v) && v.length) (v as string[]).forEach((id) => bump(id));
      else bump(null);
    } else bump(typeof v === 'string' ? v : null);
  }
  const out = [...counts.entries()].map(([key, count]) => ({ key, count }));
  if (prop.type === 'SELECT') {
    const order = ((prop.config as { options?: { id: string }[] })?.options ?? []).map((o) => o.id);
    for (const id of order) if (!counts.has(id)) out.push({ key: id, count: 0 });
    out.sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : order.indexOf(a.key) - order.indexOf(b.key)));
  }
  return out;
}
