/**
 * 고정 페이지 키별 구조화 편집 폼 정의 (API page-schemas.ts 와 동일한 구조).
 */
export type FieldDef =
  | { name: string; label: string; type: 'text' | 'textarea' | 'markdown' | 'link'; hint?: string; max?: number }
  | { name: string; label: string; type: 'lines'; hint?: string }
  | { name: string; label: string; type: 'group'; fields: FieldDef[] }
  | { name: string; label: string; type: 'list'; itemLabel: string; fields: FieldDef[]; max: number };

const heading: FieldDef = { name: 'heading', label: '제목', type: 'text', max: 200 };
const body: FieldDef = { name: 'body', label: '본문 (마크다운)', type: 'markdown', max: 20000 };
const areaFields: FieldDef[] = [
  { name: 'key', label: '키', type: 'text', hint: '영문 식별자 (예: media)', max: 40 },
  { name: 'title', label: '제목', type: 'text', max: 120 },
  { name: 'body', label: '설명', type: 'textarea', max: 1000 },
];

export const PAGE_FIELDS: Record<string, FieldDef[]> = {
  home: [
    {
      name: 'hero', label: 'Hero', type: 'group', fields: [
        { name: 'eyebrow', label: '워드마크', type: 'text', hint: '하단 대형 타이포 (예: OOGAM)', max: 80 },
        { name: 'title', label: '헤드라인', type: 'text', max: 200 },
        { name: 'lines', label: '서브 라인 (한 줄에 하나)', type: 'lines', hint: '예: Creative Business. / Media. / Technology.' },
        { name: 'ctaLabel', label: '버튼 문구', type: 'text', max: 60 },
        { name: 'ctaHref', label: '버튼 링크', type: 'link' },
      ],
    },
    { name: 'intro', label: '회사 소개', type: 'group', fields: [heading, { name: 'body', label: '본문', type: 'textarea', max: 3000 }] },
    { name: 'business', label: '사업 영역', type: 'list', itemLabel: '영역', fields: areaFields, max: 6 },
    {
      name: 'cta', label: '파트너십 CTA', type: 'group', fields: [
        heading, { name: 'label', label: '버튼 문구', type: 'text', max: 60 }, { name: 'href', label: '버튼 링크', type: 'link' },
      ],
    },
  ],
  about: [heading, body, { name: 'values', label: '핵심 가치', type: 'list', itemLabel: '가치', max: 12, fields: [{ name: 'title', label: '제목', type: 'text', max: 120 }, { name: 'body', label: '설명', type: 'textarea', max: 1000 }] }],
  business: [heading, body, { name: 'areas', label: '사업 영역', type: 'list', itemLabel: '영역', fields: areaFields, max: 12 }],
  careers: [heading, body],
  contact: [
    heading, { name: 'body', label: '안내 문구', type: 'textarea', max: 20000 },
    { name: 'email', label: '이메일', type: 'text', max: 254 }, { name: 'phone', label: '전화', type: 'text', max: 40 }, { name: 'address', label: '주소', type: 'text', max: 300 },
  ],
  privacy: [heading, { name: 'effectiveDate', label: '시행일', type: 'text', hint: '예: 2026-12-01', max: 40 }, body],
  terms: [heading, { name: 'effectiveDate', label: '시행일', type: 'text', hint: '예: 2026-12-01', max: 40 }, body],
  site: [
    { name: 'companyName', label: '상호', type: 'text', max: 120 },
    { name: 'ceo', label: '대표자', type: 'text', max: 80 },
    { name: 'businessNumber', label: '사업자등록번호', type: 'text', max: 40 },
    { name: 'address', label: '주소', type: 'text', max: 300 },
    { name: 'email', label: '이메일', type: 'text', max: 254 },
    { name: 'phone', label: '전화', type: 'text', max: 40 },
    { name: 'tagline', label: '푸터 태그라인', type: 'text', max: 200 },
    { name: 'copyright', label: '저작권 문구', type: 'text', hint: '비우면 © 연도 OOGAM 자동 표기', max: 200 },
    { name: 'socials', label: 'SNS 링크', type: 'list', itemLabel: '링크', max: 10, fields: [{ name: 'label', label: '이름', type: 'text', max: 40 }, { name: 'href', label: 'URL', type: 'link' }] },
  ],
};

/** 빈 문자열/빈 객체/빈 배열 제거 (API 의 엄격한 구조 검증과 맞춤) */
export function cleanContent(v: unknown): unknown {
  if (Array.isArray(v)) {
    const arr = v.map(cleanContent).filter((x) => x !== undefined);
    return arr;
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const c = cleanContent(x);
      if (c === undefined) continue;
      if (typeof c === 'object' && c !== null && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out;
  }
  if (typeof v === 'string') return v === '' ? undefined : v;
  return v;
}
