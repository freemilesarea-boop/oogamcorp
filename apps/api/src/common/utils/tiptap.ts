/** Tiptap(ProseMirror) JSON 에서 검색용 평문을 추출한다 */
export function extractText(node: unknown, max = 100_000): string {
  const out: string[] = [];
  let len = 0;
  const walk = (n: unknown) => {
    if (len > max || !n || typeof n !== 'object') return;
    const obj = n as { type?: string; text?: string; content?: unknown[] };
    if (typeof obj.text === 'string') {
      out.push(obj.text);
      len += obj.text.length;
    }
    if (Array.isArray(obj.content)) {
      for (const c of obj.content) walk(c);
      if (obj.type && obj.type !== 'text') out.push('\n');
    }
  };
  walk(node);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

const ALLOWED_LINK = /^(https?:|mailto:|tel:|\/|#)/i;

/**
 * 저장 전 문서 JSON 정화: 허용되지 않은 링크 프로토콜(javascript: 등) 제거.
 * 렌더링은 ProseMirror 스키마 기반이라 임의 HTML 은 실행되지 않지만 심층 방어로 처리한다.
 */
export function sanitizeDoc<T>(doc: T): T {
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (!n || typeof n !== 'object') return n;
    const obj = { ...(n as Record<string, unknown>) };
    if (obj.attrs && typeof obj.attrs === 'object') {
      const attrs = { ...(obj.attrs as Record<string, unknown>) };
      for (const key of ['href', 'src']) {
        const v = attrs[key];
        if (typeof v === 'string' && !ALLOWED_LINK.test(v.trim())) attrs[key] = null;
      }
      obj.attrs = attrs;
    }
    if (Array.isArray(obj.marks)) obj.marks = walk(obj.marks);
    if (Array.isArray(obj.content)) obj.content = walk(obj.content);
    return obj;
  };
  return walk(doc) as T;
}
