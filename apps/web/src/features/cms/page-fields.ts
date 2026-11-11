/**
 * 고정 페이지 키별 구조화 편집 폼 정의 (API page-schemas.ts 와 동일한 구조).
 */
export type FieldDef =
  | { name: string; label: string; type: 'text' | 'textarea' | 'markdown' | 'link' | 'image'; hint?: string; max?: number }
  | { name: string; label: string; type: 'bool'; hint?: string }
  | { name: string; label: string; type: 'sections'; hint?: string }
  | { name: string; label: string; type: 'lines'; hint?: string }
  | { name: string; label: string; type: 'group'; fields: FieldDef[] }
  | { name: string; label: string; type: 'list'; itemLabel: string; fields: FieldDef[]; max: number };

const heading: FieldDef = { name: 'heading', label: '제목', type: 'text', max: 200 };
const body: FieldDef = { name: 'body', label: '본문 (마크다운)', type: 'markdown', max: 20000 };
const label: FieldDef = { name: 'label', label: '섹션 라벨', type: 'text', hint: '작은 영문 라벨 (예: Brands)', max: 80 };
const lead: FieldDef = { name: 'lead', label: '리드 문구', type: 'textarea', max: 1000 };
/** 목록 페이지 상단(라벨·제목·리드)과 빈 상태 문구 */
const listIntro = (example: string): FieldDef[] => [
  { name: 'label', label: '상단 라벨', type: 'text', hint: `예: ${example}`, max: 80 },
  { name: 'heading', label: '제목', type: 'text', max: 200 },
  lead,
  { name: 'emptyTitle', label: '빈 목록 제목', type: 'text', hint: '게시된 항목이 없을 때 표시', max: 200 },
  { name: 'emptyBody', label: '빈 목록 설명', type: 'textarea', max: 500 },
];
const sectionGroup = (name: string, title: string, withEmpty = true): FieldDef => ({
  name, label: title, type: 'group', fields: [
    label,
    { name: 'heading', label: '제목', type: 'text', max: 200 },
    { name: 'linkLabel', label: '전체 보기 링크 문구', type: 'text', max: 60 },
    ...(withEmpty ? [{ name: 'emptyTitle', label: '빈 목록 제목', type: 'text', max: 200 } as FieldDef, { name: 'emptyBody', label: '빈 목록 설명', type: 'textarea', max: 500 } as FieldDef] : []),
  ],
});
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
        { name: 'lines', label: '서브 라인 (한 줄에 하나)', type: 'lines', hint: '예: AI Education. / AI Music Media. / AI Technology.' },
        { name: 'ctaLabel', label: '버튼 문구', type: 'text', max: 60 },
        { name: 'ctaHref', label: '버튼 링크', type: 'link' },
        { name: 'imageUrl', label: '배경 이미지 (선택)', type: 'image', hint: '어둡게 처리되어 헤드라인 뒤에 표시됩니다' },
      ],
    },
    { name: 'sections', label: '섹션 표시·순서', type: 'sections', hint: '숨긴 섹션은 공개 사이트에 표시되지 않습니다' },
    {
      name: 'intro', label: '회사 소개', type: 'group', fields: [
        label, heading, { name: 'body', label: '본문', type: 'textarea', max: 3000 },
        { name: 'linkLabel', label: '링크 문구', type: 'text', hint: '기본: 회사 소개', max: 60 }, { name: 'linkHref', label: '링크 주소', type: 'link', hint: '기본: /about' },
        { name: 'imageUrl', label: '이미지 (선택)', type: 'image' },
      ],
    },
    sectionGroup('businessSection', '사업 영역 섹션 문구', false),
    sectionGroup('brandsSection', '브랜드 섹션 문구'),
    sectionGroup('featuredSection', '주요 프로젝트 섹션 문구'),
    sectionGroup('newsSection', '뉴스 섹션 문구'),
    {
      name: 'cta', label: '파트너십 CTA', type: 'group', fields: [
        label, heading, { name: 'label', label: '버튼 문구', type: 'text', max: 60 }, { name: 'href', label: '버튼 링크', type: 'link' },
      ],
    },
    { name: 'business', label: '(구) 사업 영역 목록', type: 'list', itemLabel: '영역', fields: areaFields, max: 6 },
  ],
  about: [
    { name: 'label', label: '상단 라벨', type: 'text', max: 80 }, heading, lead, { name: 'imageUrl', label: '대표 이미지', type: 'image' }, body,
    { name: 'values', label: '핵심 가치', type: 'list', itemLabel: '가치', max: 12, fields: [{ name: 'title', label: '제목', type: 'text', max: 120 }, { name: 'body', label: '설명', type: 'textarea', max: 1000 }] },
  ],
  business: [{ name: 'label', label: '상단 라벨', type: 'text', max: 80 }, heading, lead, body, { name: 'areas', label: '(구) 사업 영역 목록', type: 'list', itemLabel: '영역', fields: areaFields, max: 12 }],
  brands: listIntro('Brands'),
  portfolio: listIntro('Portfolio'),
  news: listIntro('News'),
  careers: [...listIntro('Careers').slice(0, 3), body, ...listIntro('Careers').slice(3)],
  contact: [
    { name: 'label', label: '상단 라벨', type: 'text', max: 80 }, heading, { name: 'body', label: '안내 문구', type: 'textarea', max: 20000 },
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
    {
      name: 'nav', label: '헤더·푸터 메뉴', type: 'list', itemLabel: '메뉴', max: 10,
      fields: [{ name: 'label', label: '메뉴명', type: 'text', max: 40 }, { name: 'href', label: '링크', type: 'link' }, { name: 'visible', label: '표시', type: 'bool' }],
    },
    { name: 'headerCtaLabel', label: '헤더 버튼 문구 (선택)', type: 'text', max: 40 },
    { name: 'headerCtaHref', label: '헤더 버튼 링크', type: 'link' },
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
  return v; // boolean 등은 그대로 (false 유지)
}

/** 홈 섹션 (API HOME_SECTION_KEYS 와 동일) */
export const HOME_SECTIONS: { key: string; label: string }[] = [
  { key: 'hero', label: 'Hero (메인 헤드라인)' },
  { key: 'intro', label: '회사 소개' },
  { key: 'business', label: '사업 영역' },
  { key: 'brands', label: '브랜드' },
  { key: 'featured', label: '주요 프로젝트' },
  { key: 'news', label: '뉴스' },
  { key: 'cta', label: '파트너십 CTA' },
];
