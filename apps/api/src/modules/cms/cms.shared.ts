import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContentStatus, Prisma } from '@prisma/client';
import { slugify, SLUG_PATTERN } from '@oogam/shared';
import type { AuthContext } from '../../common/auth/auth.types';

/**
 * 콘텐츠 상태 워크플로
 *  - 편집자(cms.write): DRAFT ↔ REVIEW 만 가능
 *  - 게시 승인자(cms.publish): 게시(PUBLISHED), 게시 중단(→DRAFT), 보관(ARCHIVED), 보관 해제(→DRAFT)
 */
const TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  DRAFT: ['REVIEW', 'PUBLISHED', 'ARCHIVED'],
  REVIEW: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

export function canPublish(auth: AuthContext): boolean {
  return auth.permissions.has('cms.publish');
}

export function assertTransition(auth: AuthContext, from: ContentStatus, to: ContentStatus): void {
  if (!TRANSITIONS[from].includes(to)) throw new BadRequestException(`'${from}' 상태에서 '${to}' 상태로 변경할 수 없습니다.`);
  const editorMove = (from === 'DRAFT' || from === 'REVIEW') && (to === 'DRAFT' || to === 'REVIEW');
  if (!editorMove && !canPublish(auth)) {
    throw new ForbiddenException('게시·게시 중단·보관은 게시 승인 권한(cms.publish)이 필요합니다.');
  }
}

/** 게시 중인 콘텐츠의 직접 수정/삭제는 게시 권한자만 (편집자는 게시 중단 요청 후 수정) */
export function assertEditable(auth: AuthContext, status: ContentStatus): void {
  if (status === 'PUBLISHED' && !canPublish(auth)) {
    throw new ForbiddenException('게시 중인 콘텐츠는 게시 승인 권한(cms.publish)이 있어야 수정할 수 있습니다.');
  }
}

/** 상태 변경 감사 로그 액션명 */
export function transitionAction(entity: string, from: ContentStatus, to: ContentStatus): string {
  if (to === 'PUBLISHED') return `cms.${entity}.published`;
  if (from === 'PUBLISHED') return to === 'ARCHIVED' ? `cms.${entity}.archived` : `cms.${entity}.unpublished`;
  if (to === 'ARCHIVED') return `cms.${entity}.archived`;
  return `cms.${entity}.status_changed`;
}

export function resolveSlug(explicit: string | undefined, source: string): string {
  const slug = explicit ?? slugify(source);
  if (!slug || !SLUG_PATTERN.test(slug)) throw new BadRequestException('유효한 슬러그를 입력하세요 (영문 소문자·숫자·한글·하이픈).');
  return slug;
}

/** 소프트 삭제 시 슬러그를 비워 동일 슬러그 재사용 허용 */
export function deletedSlug(slug: string, id: string): string {
  return `${slug.slice(0, 80)}--deleted-${id.slice(0, 8)}-${Date.now().toString(36)}`;
}

export const nullableDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

// ───────────── 채용 메타데이터 ─────────────
const CAREER_FIELDS: Record<string, number> = { location: 200, employmentType: 80, deadline: 40, team: 120, applyUrl: 1000, experience: 120 };
const EMPLOYMENT_TYPES = ['FULL_TIME', 'CONTRACT', 'PART_TIME', 'INTERN', 'FREELANCE'];

export function validatePostMetadata(type: string, metadata: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (metadata === undefined) return undefined;
  if (type !== 'CAREER') {
    if (Object.keys(metadata).length) throw new BadRequestException('부가정보(metadata)는 채용 공고에서만 사용할 수 있습니다.');
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!(k in CAREER_FIELDS)) throw new BadRequestException(`허용되지 않은 채용 정보 필드: ${k}`);
    if (v === null || v === '') continue;
    if (typeof v !== 'string' || v.length > CAREER_FIELDS[k]) throw new BadRequestException(`채용 정보 '${k}' 값이 올바르지 않습니다.`);
    if (k === 'employmentType' && !EMPLOYMENT_TYPES.includes(v)) throw new BadRequestException('고용 형태 값이 올바르지 않습니다.');
    if (k === 'deadline' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestException('마감일은 YYYY-MM-DD 형식이어야 합니다.');
    if (k === 'applyUrl' && !/^(https?:\/\/|mailto:)/i.test(v)) throw new BadRequestException('지원 링크는 http(s):// 또는 mailto: 로 시작해야 합니다.');
    out[k] = v;
  }
  return out;
}
