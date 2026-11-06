import { TiptapTransformer } from '@hocuspocus/transformer';
import * as Y from 'yjs';

/** Tiptap Collaboration 확장이 사용하는 기본 XmlFragment 필드명 */
export const Y_FIELD = 'default';

interface PmNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: PmNode[];
}

/**
 * ProseMirror JSON → Y.XmlFragment 노드 (스키마 비의존).
 *
 * TiptapTransformer.toYdoc 은 서버 측에 Tiptap 확장(스키마)을 모두 등록해야 커스텀 노드
 * (toggle/callout/table 등)를 보존할 수 있다. 서버에 웹 에디터 확장 전체를 중복 구현하지 않기 위해,
 * y-prosemirror 의 내부 표현(요소 = Y.XmlElement(nodeName) + attributes, 텍스트 = Y.XmlText + 마크 속성)을
 * 그대로 따르는 스키마 비의존 변환을 사용한다. 역변환은 TiptapTransformer.fromYdoc(스키마 불필요)을 사용한다.
 */
function toYNodes(nodes: PmNode[] | undefined): (Y.XmlElement | Y.XmlText)[] {
  const out: (Y.XmlElement | Y.XmlText)[] = [];
  if (!Array.isArray(nodes)) return out;
  let pendingText: { insert: string; attributes?: Record<string, unknown> }[] = [];
  const flush = () => {
    if (!pendingText.length) return;
    const t = new Y.XmlText();
    t.applyDelta(pendingText);
    out.push(t);
    pendingText = [];
  };
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'text') {
      if (typeof n.text !== 'string' || n.text.length === 0) continue;
      const attributes: Record<string, unknown> = {};
      for (const m of n.marks ?? []) if (m?.type) attributes[m.type] = m.attrs ?? {};
      pendingText.push(Object.keys(attributes).length ? { insert: n.text, attributes } : { insert: n.text });
      continue;
    }
    flush();
    if (!n.type) continue;
    const el = new Y.XmlElement(n.type);
    for (const [k, v] of Object.entries(n.attrs ?? {})) {
      if (v !== null && v !== undefined) el.setAttribute(k, v as string);
    }
    const children = toYNodes(n.content);
    if (children.length) el.insert(0, children);
    out.push(el);
  }
  flush();
  return out;
}

/** JSON 문서로 새 Y.Doc 생성 */
export function jsonToYdoc(json: unknown, field = Y_FIELD): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment(field);
  const nodes = toYNodes((json as PmNode | null)?.content);
  if (nodes.length) doc.transact(() => frag.insert(0, nodes));
  return doc;
}

/** Y.Doc → ProseMirror JSON */
export function ydocToJson(doc: Y.Doc, field = Y_FIELD): { type: 'doc'; content: unknown[] } {
  const json = TiptapTransformer.fromYdoc(doc, field) as { type?: string; content?: unknown[] } | null;
  return { type: 'doc', content: Array.isArray(json?.content) ? json!.content : [] };
}

/**
 * 기존 Yjs 상태를 유지한 채 문서 내용을 교체한 새 상태를 만든다.
 * (기존 항목은 삭제 처리, 새 항목은 동일 Doc 위에 삽입 → 기존 클라이언트 상태와 CRDT 병합 시 중복이 생기지 않는다)
 * REST 저장/버전 복원 시 yState 가 이미 있으면 이 함수로 갱신한다.
 */
export function replaceYContent(yState: Uint8Array | null | undefined, json: unknown, field = Y_FIELD): Uint8Array<ArrayBuffer> {
  if (!yState) return toBytes(Y.encodeStateAsUpdate(jsonToYdoc(json, field)));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yState);
  applyJsonToDoc(doc, json, field);
  return toBytes(Y.encodeStateAsUpdate(doc));
}

/** Prisma Bytes 필드에 저장 가능한 형태로 복사 */
export function toBytes(u: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(u.byteLength));
  out.set(u);
  return out;
}

/** 살아있는 Y.Doc 의 내용을 JSON 으로 교체 (단일 트랜잭션) */
export function applyJsonToDoc(doc: Y.Doc, json: unknown, field = Y_FIELD): void {
  const frag = doc.getXmlFragment(field);
  const nodes = toYNodes((json as PmNode | null)?.content);
  doc.transact(() => {
    if (frag.length) frag.delete(0, frag.length);
    if (nodes.length) frag.insert(0, nodes);
  });
}
