import { BadRequestException } from '@nestjs/common';

/**
 * 고정 페이지(website_pages) 키별 content 구조.
 * 모든 필드는 선택이며, 정의되지 않은 필드는 거부한다(오타·임의 데이터 저장 방지).
 * 링크 필드는 내부 경로(/...) 또는 http(s)/mailto 만 허용한다.
 */
type Spec =
  | { t: 'str'; max: number; link?: boolean }
  | { t: 'strs'; max: number; maxItems: number }
  | { t: 'obj'; fields: Fields }
  | { t: 'list'; maxItems: number; item: Fields };
type Fields = Record<string, Spec>;

const s = (max: number): Spec => ({ t: 'str', max });
const link: Spec = { t: 'str', max: 1000, link: true };
const generic: Fields = { heading: s(200), body: s(20_000) };
const area: Fields = { key: s(40), title: s(120), body: s(1000) };

export const PAGE_SCHEMAS: Record<string, Fields> = {
  home: {
    hero: { t: 'obj', fields: { eyebrow: s(80), title: s(200), lines: { t: 'strs', max: 120, maxItems: 6 }, ctaLabel: s(60), ctaHref: link } },
    intro: { t: 'obj', fields: { heading: s(200), body: s(3000) } },
    business: { t: 'list', maxItems: 6, item: area },
    cta: { t: 'obj', fields: { heading: s(200), label: s(60), href: link } },
  },
  about: { ...generic, values: { t: 'list', maxItems: 12, item: { title: s(120), body: s(1000) } } },
  business: { ...generic, areas: { t: 'list', maxItems: 12, item: area } },
  careers: { ...generic },
  contact: { ...generic, email: s(254), phone: s(40), address: s(300) },
  privacy: { ...generic, effectiveDate: s(40) },
  terms: { ...generic, effectiveDate: s(40) },
  /** 사이트 공통 정보 (푸터 회사 정보·SNS 링크) */
  site: {
    companyName: s(120), ceo: s(80), businessNumber: s(40), address: s(300), email: s(254), phone: s(40),
    tagline: s(200), copyright: s(200),
    socials: { t: 'list', maxItems: 10, item: { label: s(40), href: link } },
  },
};

export const PAGE_KEYS = Object.keys(PAGE_SCHEMAS);
export const PAGE_TITLES: Record<string, string> = {
  home: '홈', about: '회사 소개', business: '사업 영역', careers: '채용', contact: '문의',
  privacy: '개인정보처리방침', terms: '이용약관', site: '사이트 공통 정보(푸터)',
};

const LINK_RE = /^(\/(?!\/)|https?:\/\/|mailto:)/i;

function check(path: string, spec: Spec, v: unknown): void {
  if (v === null || v === undefined) return;
  const fail = (msg: string) => {
    throw new BadRequestException(`content.${path}: ${msg}`);
  };
  switch (spec.t) {
    case 'str':
      if (typeof v !== 'string') fail('문자열이어야 합니다.');
      if ((v as string).length > spec.max) fail(`최대 ${spec.max}자까지 입력할 수 있습니다.`);
      if (spec.link && v !== '' && !LINK_RE.test(v as string)) fail('링크는 / 로 시작하는 내부 경로 또는 http(s)/mailto 주소여야 합니다.');
      return;
    case 'strs':
      if (!Array.isArray(v)) fail('배열이어야 합니다.');
      if ((v as unknown[]).length > spec.maxItems) fail(`최대 ${spec.maxItems}개까지 입력할 수 있습니다.`);
      (v as unknown[]).forEach((x, i) => check(`${path}[${i}]`, { t: 'str', max: spec.max }, x));
      return;
    case 'obj':
      if (typeof v !== 'object' || Array.isArray(v)) fail('객체여야 합니다.');
      checkFields(path, spec.fields, v as Record<string, unknown>);
      return;
    case 'list':
      if (!Array.isArray(v)) fail('배열이어야 합니다.');
      if ((v as unknown[]).length > spec.maxItems) fail(`최대 ${spec.maxItems}개까지 입력할 수 있습니다.`);
      (v as unknown[]).forEach((x, i) => {
        if (typeof x !== 'object' || x === null || Array.isArray(x)) fail(`[${i}] 객체여야 합니다.`);
        checkFields(`${path}[${i}]`, spec.item, x as Record<string, unknown>);
      });
      return;
  }
}

function checkFields(prefix: string, fields: Fields, obj: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    const spec = fields[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (!spec) throw new BadRequestException(`content.${path}: 허용되지 않은 필드입니다.`);
    check(path, spec, v);
  }
}

export function validatePageContent(key: string, content: Record<string, unknown>): void {
  const schema = PAGE_SCHEMAS[key];
  if (!schema) throw new BadRequestException('지원하지 않는 페이지 키입니다.');
  if (JSON.stringify(content).length > 100_000) throw new BadRequestException('콘텐츠가 너무 큽니다.');
  checkFields('', schema, content);
}
