import { BadRequestException } from '@nestjs/common';
import type { DbPropertyType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * 커스텀 데이터베이스 스키마 규칙 (속성 설정 / 셀 값 검증 / 타입 변환).
 * 모든 셀 값은 저장 전에 normalizeCell 을 통과해야 한다. 참조형(사람/파일/관계)은
 * 형태만 여기서 검증하고, 실제 존재 여부는 CellRefs 를 모아 서비스에서 일괄 확인한다.
 */

export interface SelectOption { id: string; name: string; color: string }
export interface PropertyConfig {
  options?: SelectOption[];
  format?: NumberFormat;
  targetDatabaseId?: string;
  includeTime?: boolean;
}
export interface PropLike { id: string; name: string; type: DbPropertyType; config: unknown }

export const NUMBER_FORMATS = ['number', 'integer', 'percent', 'currency_krw', 'currency_usd'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export const OPTION_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export const UNSUPPORTED_TYPES: DbPropertyType[] = ['FORMULA', 'ROLLUP'];
export const MAX_TEXT = 10_000;
export const MAX_TITLE = 2_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export class CellError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
  }
}

export function cfg(p: { config: unknown }): PropertyConfig {
  return (p.config && typeof p.config === 'object' && !Array.isArray(p.config) ? p.config : {}) as PropertyConfig;
}

export function assertSupportedType(type: DbPropertyType) {
  if (UNSUPPORTED_TYPES.includes(type)) {
    throw new BadRequestException(
      `${type} 속성은 후속 구현 예정입니다. 계산 엔진(FormulaEvaluator)이 준비되면 활성화됩니다.`,
    );
  }
}

/** 속성 설정 검증·정규화. RELATION 대상 DB 존재 여부는 서비스에서 확인 */
export function normalizeConfig(type: DbPropertyType, raw: Record<string, unknown> | undefined): PropertyConfig {
  const c = raw ?? {};
  const allowed: Record<string, string[]> = {
    SELECT: ['options'],
    MULTI_SELECT: ['options'],
    NUMBER: ['format'],
    RELATION: ['targetDatabaseId'],
    DATE: ['includeTime'],
  };
  const keys = allowed[type] ?? [];
  for (const k of Object.keys(c)) {
    if (!keys.includes(k)) throw new BadRequestException(`config.${k}: ${type} 속성에서 지원하지 않는 설정입니다.`);
  }
  const out: PropertyConfig = {};
  if (type === 'SELECT' || type === 'MULTI_SELECT') {
    const opts = c.options ?? [];
    if (!Array.isArray(opts) || opts.length > 200) throw new BadRequestException('config.options: 옵션은 최대 200개의 배열이어야 합니다.');
    const ids = new Set<string>();
    const names = new Set<string>();
    out.options = opts.map((o, i) => {
      if (!o || typeof o !== 'object') throw new BadRequestException(`config.options[${i}]: 옵션 형식이 올바르지 않습니다.`);
      const { id, name, color, ...rest } = o as Record<string, unknown>;
      if (Object.keys(rest).length) throw new BadRequestException(`config.options[${i}]: 허용되지 않는 필드가 있습니다.`);
      if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new BadRequestException(`config.options[${i}].name: 1~100자 이름이 필요합니다.`);
      if (id !== undefined && (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(id))) throw new BadRequestException(`config.options[${i}].id: 형식이 올바르지 않습니다.`);
      if (color !== undefined && !(OPTION_COLORS as readonly unknown[]).includes(color)) throw new BadRequestException(`config.options[${i}].color: 허용되지 않는 색상입니다.`);
      const oid = (id as string | undefined) ?? randomUUID().slice(0, 8);
      if (ids.has(oid)) throw new BadRequestException(`config.options[${i}].id: 중복된 옵션 ID 입니다.`);
      if (names.has(name.trim())) throw new BadRequestException(`config.options[${i}].name: 중복된 옵션 이름입니다.`);
      ids.add(oid);
      names.add(name.trim());
      return { id: oid, name: name.trim(), color: (color as string | undefined) ?? 'gray' };
    });
  } else if (type === 'NUMBER') {
    if (c.format !== undefined && !(NUMBER_FORMATS as readonly unknown[]).includes(c.format)) throw new BadRequestException('config.format: 지원하지 않는 숫자 형식입니다.');
    out.format = (c.format as NumberFormat | undefined) ?? 'number';
  } else if (type === 'RELATION') {
    if (typeof c.targetDatabaseId !== 'string' || !UUID_RE.test(c.targetDatabaseId)) throw new BadRequestException('config.targetDatabaseId: 관계 대상 데이터베이스가 필요합니다.');
    out.targetDatabaseId = c.targetDatabaseId;
  } else if (type === 'DATE') {
    if (c.includeTime !== undefined && typeof c.includeTime !== 'boolean') throw new BadRequestException('config.includeTime: boolean 이어야 합니다.');
    if (c.includeTime !== undefined) out.includeTime = c.includeTime as boolean;
  }
  return out;
}

/** 존재 확인이 필요한 참조 */
export interface CellRefs {
  users: Set<string>;
  files: Set<string>;
  /** targetDatabaseId → rowIds */
  rows: Map<string, Set<string>>;
}
export const emptyRefs = (): CellRefs => ({ users: new Set(), files: new Set(), rows: new Map() });

function uuidArray(field: string, v: unknown, max: number, label: string): string[] {
  if (!Array.isArray(v)) throw new CellError(field, `${label} ID 배열이어야 합니다.`);
  if (v.length > max) throw new CellError(field, `${label}은(는) 최대 ${max}개까지 지정할 수 있습니다.`);
  for (const x of v) if (typeof x !== 'string' || !UUID_RE.test(x)) throw new CellError(field, `${label} ID 형식이 올바르지 않습니다.`);
  return [...new Set(v as string[])];
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && ISO_RE.test(s) && !Number.isNaN(Date.parse(s));
}

/**
 * 셀 값 검증·정규화. null/undefined 는 값 지우기(null 반환).
 * 반환값은 DB 저장 형태(JSON). 참조형 ID 는 refs 에 수집된다.
 */
export function normalizeCell(prop: PropLike, raw: unknown, refs: CellRefs): Prisma.InputJsonValue | null {
  const f = prop.name;
  if (raw === null || raw === undefined) return null;
  const c = cfg(prop);
  switch (prop.type) {
    case 'TITLE':
    case 'TEXT': {
      if (typeof raw !== 'string') throw new CellError(f, '텍스트 값이어야 합니다.');
      const max = prop.type === 'TITLE' ? MAX_TITLE : MAX_TEXT;
      if (raw.length > max) throw new CellError(f, `최대 ${max.toLocaleString()}자까지 입력할 수 있습니다.`);
      return raw === '' ? null : raw;
    }
    case 'NUMBER': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new CellError(f, '유한한 숫자여야 합니다.');
      if (c.format === 'integer' && !Number.isInteger(raw)) throw new CellError(f, '정수여야 합니다.');
      return raw;
    }
    case 'SELECT': {
      if (typeof raw !== 'string') throw new CellError(f, '선택 옵션 ID 여야 합니다.');
      if (!(c.options ?? []).some((o) => o.id === raw)) throw new CellError(f, '존재하지 않는 선택 옵션입니다.');
      return raw;
    }
    case 'MULTI_SELECT': {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) throw new CellError(f, '선택 옵션 ID 배열이어야 합니다.');
      const ids = [...new Set(raw as string[])];
      const valid = new Set((c.options ?? []).map((o) => o.id));
      if (ids.some((x) => !valid.has(x))) throw new CellError(f, '존재하지 않는 선택 옵션이 포함되어 있습니다.');
      return ids.length ? ids : null;
    }
    case 'DATE': {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CellError(f, '{ start, end? } 형식의 날짜여야 합니다.');
      const { start, end, ...rest } = raw as Record<string, unknown>;
      if (Object.keys(rest).length) throw new CellError(f, '날짜 값에 허용되지 않는 필드가 있습니다.');
      if (!isIsoDate(start)) throw new CellError(f, '시작일은 ISO 8601 날짜여야 합니다.');
      if (end !== undefined && end !== null) {
        if (!isIsoDate(end)) throw new CellError(f, '종료일은 ISO 8601 날짜여야 합니다.');
        if (Date.parse(end) < Date.parse(start)) throw new CellError(f, '종료일은 시작일 이후여야 합니다.');
        return { start, end };
      }
      return { start };
    }
    case 'CHECKBOX': {
      if (typeof raw !== 'boolean') throw new CellError(f, 'true/false 값이어야 합니다.');
      return raw;
    }
    case 'PERSON': {
      const ids = uuidArray(f, raw, 50, '사용자');
      ids.forEach((id) => refs.users.add(id));
      return ids.length ? ids : null;
    }
    case 'URL': {
      if (typeof raw !== 'string' || raw.length > 2000) throw new CellError(f, '2000자 이하의 URL 이어야 합니다.');
      if (raw === '') return null;
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        throw new CellError(f, '올바른 URL 형식이 아닙니다.');
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new CellError(f, 'http(s) URL 만 허용됩니다.');
      return raw;
    }
    case 'FILE': {
      const ids = uuidArray(f, raw, 20, '파일');
      ids.forEach((id) => refs.files.add(id));
      return ids.length ? ids : null;
    }
    case 'RELATION': {
      const ids = uuidArray(f, raw, 100, '관계 행');
      if (!c.targetDatabaseId) throw new CellError(f, '관계 대상이 설정되지 않았습니다.');
      const set = refs.rows.get(c.targetDatabaseId) ?? new Set<string>();
      ids.forEach((id) => set.add(id));
      refs.rows.set(c.targetDatabaseId, set);
      return ids.length ? ids : null;
    }
    default:
      throw new CellError(f, `${prop.type} 속성 값은 직접 입력할 수 없습니다(후속 구현).`);
  }
}

/** 타입 변경 시 기존 셀 값 변환. 변환 불가하면 undefined (셀 삭제) */
export function convertValue(
  value: unknown,
  from: PropLike,
  to: { type: DbPropertyType; config: PropertyConfig },
  ensureOption: (name: string) => string | undefined,
): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  const text = displayText(from, value, undefined);
  switch (to.type) {
    case 'TITLE':
    case 'TEXT':
      return text ? text.slice(0, to.type === 'TITLE' ? MAX_TITLE : MAX_TEXT) : undefined;
    case 'NUMBER': {
      if (from.type === 'CHECKBOX') return value ? 1 : 0;
      const n = typeof value === 'number' ? value : Number(String(text).replace(/,/g, '').trim());
      if (!Number.isFinite(n) || text.trim() === '') return undefined;
      return to.config.format === 'integer' ? Math.round(n) : n;
    }
    case 'CHECKBOX': {
      if (from.type === 'NUMBER') return value !== 0;
      const b = parseBool(text);
      return b === undefined ? undefined : b;
    }
    case 'SELECT': {
      const first = from.type === 'MULTI_SELECT' && Array.isArray(value) ? displayText(from, [value[0]], undefined) : text;
      if (!first) return undefined;
      return ensureOption(first);
    }
    case 'MULTI_SELECT': {
      const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
      const ids = parts.map((p) => ensureOption(p)).filter((x): x is string => !!x);
      return ids.length ? [...new Set(ids)] : undefined;
    }
    case 'DATE': {
      const parsed = parseDateText(text);
      return parsed ?? undefined;
    }
    case 'URL': {
      try {
        const u = new URL(text.trim());
        return u.protocol === 'http:' || u.protocol === 'https:' ? text.trim() : undefined;
      } catch {
        return undefined;
      }
    }
    // 참조형은 같은 타입끼리만 유지 (호출부에서 처리) — 그 외에는 지운다
    default:
      return undefined;
  }
}

export function parseBool(s: string): boolean | undefined {
  const v = s.trim().toLowerCase();
  if (['true', '1', 'y', 'yes', '예', 'o', 'v', '✓', 'checked'].includes(v)) return true;
  if (['false', '0', 'n', 'no', '아니오', 'x', '', 'unchecked'].includes(v)) return false;
  return undefined;
}

/** "2026-01-01" 또는 "2026-01-01 ~ 2026-01-03" */
export function parseDateText(s: string): { start: string; end?: string } | null {
  const [a, b] = s.split('~').map((x) => x.trim());
  if (!isIsoDate(a)) return null;
  if (b) {
    if (!isIsoDate(b) || Date.parse(b) < Date.parse(a)) return null;
    return { start: a, end: b };
  }
  return { start: a };
}

export interface DisplayCtx {
  users?: Map<string, { name: string; email: string }>;
  rowTitles?: Map<string, string>;
  files?: Map<string, string>;
}

/** 사람이 읽을 수 있는 평문 표현 (CSV 내보내기, 타입 변환, 검색 스니펫) */
export function displayText(prop: PropLike, value: unknown, ctx: DisplayCtx | undefined): string {
  if (value === null || value === undefined) return '';
  const c = cfg(prop);
  switch (prop.type) {
    case 'TITLE':
    case 'TEXT':
    case 'URL':
      return String(value);
    case 'NUMBER':
      return typeof value === 'number' ? String(value) : '';
    case 'CHECKBOX':
      return value ? 'true' : 'false';
    case 'SELECT':
      return c.options?.find((o) => o.id === value)?.name ?? '';
    case 'MULTI_SELECT':
      return Array.isArray(value) ? value.map((id) => c.options?.find((o) => o.id === id)?.name).filter(Boolean).join(', ') : '';
    case 'DATE': {
      const v = value as { start?: string; end?: string };
      return v.start ? (v.end ? `${v.start} ~ ${v.end}` : v.start) : '';
    }
    case 'PERSON':
      return Array.isArray(value) ? value.map((id) => ctx?.users?.get(id)?.email ?? id).join(', ') : '';
    case 'RELATION':
      return Array.isArray(value) ? value.map((id) => ctx?.rowTitles?.get(id) ?? id).join(', ') : '';
    case 'FILE':
      return Array.isArray(value) ? value.map((id) => ctx?.files?.get(id) ?? id).join(', ') : '';
    default:
      return '';
  }
}
