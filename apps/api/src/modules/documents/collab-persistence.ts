import type { Prisma, PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { AccessService } from '../../common/auth/access.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { SessionService } from '../../common/auth/session.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { extractText, sanitizeDoc } from '../../common/utils/tiptap';
import { EntityAccessService } from '../access/entity-access.service';
import { AUTO_SNAPSHOT_INTERVAL_MS } from './documents.service';
import { applyJsonToDoc, jsonToYdoc, toBytes, ydocToJson } from './ydoc';

export const COLLAB_DOC_PREFIX = 'page:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CollabContext {
  userId: string;
  name: string;
  organizationId: string;
  pageId: string;
  readOnly: boolean;
}

interface DocState {
  /** 이 프로세스가 마지막으로 확인/저장한 DB 버전 */
  version: number;
  /** 마지막 저장 시점의 상태 벡터 (page_updates 증분 계산용) */
  lastVector: Uint8Array;
}

export function parsePageId(documentName: string): string | null {
  if (!documentName.startsWith(COLLAB_DOC_PREFIX)) return null;
  const id = documentName.slice(COLLAB_DOC_PREFIX.length);
  return UUID_RE.test(id) ? id : null;
}

export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(header) ? header.join('; ') : header ?? '';
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/**
 * 실시간 협업 서버(src/collab.ts)의 인증·영속화 로직.
 * Nest DI 없이 동작하도록 기존 서비스(SessionService/AccessService/EntityAccessService)를 수동 구성해
 * API 서버와 동일한 세션 해석·문서 접근 규칙을 재사용한다.
 *
 * 충돌/재연결 처리:
 *  - 동시 편집은 Yjs CRDT 가 병합한다(클라이언트는 재연결 시 상태 벡터를 교환해 누락분만 동기화).
 *  - REST 저장/버전 복원 등 외부 변경은 API 가 yState 를 CRDT 호환 방식(기존 항목 삭제 + 새 항목 삽입)으로 갱신하고
 *    version 을 올린다. 협업 서버는 version 변화를 감지(syncExternal)해 DB 상태를 메모리 문서에 병합하므로
 *    접속 중인 클라이언트에도 중복 없이 전파된다.
 */
export class CollabPersistence {
  private readonly state = new Map<string, DocState>();
  private readonly sessions: SessionService;
  private readonly entityAccess: EntityAccessService;

  constructor(private readonly prisma: PrismaClient, private readonly allowedOrigins: string[], private readonly cookieNames: string[]) {
    const access = new AccessService(prisma as PrismaService);
    this.sessions = new SessionService(prisma as PrismaService, access);
    // pageLevel 은 프로젝트/업무 서비스에 의존하지 않는다 (PAGE 판단만 사용)
    this.entityAccess = new EntityAccessService(prisma as PrismaService, access, undefined as never, undefined as never);
  }

  /** 쿠키 세션 인증 + Origin 검사(CSWSH 방지) + 문서 접근 수준 확인 */
  async authenticate(params: { documentName: string; headers: Record<string, string | string[] | undefined> }): Promise<CollabContext> {
    const origin = params.headers.origin as string | undefined;
    if (origin && !this.allowedOrigins.includes(origin)) throw new Error('forbidden origin');
    const pageId = parsePageId(params.documentName);
    if (!pageId) throw new Error('invalid document name');
    const cookies = parseCookies(params.headers.cookie);
    const token = this.cookieNames.map((n) => cookies[n]).find(Boolean);
    if (!token) throw new Error('unauthenticated');
    const auth: AuthContext | null = await this.sessions.resolve(token);
    if (!auth) throw new Error('unauthenticated');
    // MFA 미완료 세션 / 필수 MFA 미등록 세션은 공동 편집 연결 불가 (HTTP 가드와 동일 정책)
    if (!auth.mfa.verified || (auth.mfa.required && !auth.mfa.enabled)) throw new Error('mfa required');
    if (!auth.permissions.has('workspace.access')) throw new Error('forbidden');
    const page = await this.prisma.page.findFirst({ where: { id: pageId, organizationId: auth.organizationId, deletedAt: null } });
    if (!page) throw new Error('not found');
    const level = await this.entityAccess.pageLevel(auth, page);
    if (!level) throw new Error('forbidden');
    // REST 저장(docs.write 필요)과 동일하게 쓰기 권한이 없으면 읽기 전용
    const readOnly = level === 'VIEW' || level === 'COMMENT' || !auth.permissions.has('docs.write');
    return { userId: auth.userId, name: auth.name, organizationId: auth.organizationId, pageId, readOnly };
  }

  /** DB 의 yState 를 적재. 없으면 JSON 본문으로 시드(서버에서 1회 → 클라이언트 중복 시드 경합 없음) */
  async load(documentName: string, document: Y.Doc): Promise<void> {
    const pageId = parsePageId(documentName);
    if (!pageId) throw new Error('invalid document name');
    const page = await this.prisma.page.findFirst({ where: { id: pageId, deletedAt: null }, select: { yState: true, content: true, version: true } });
    if (!page) throw new Error('not found');
    if (page.yState) Y.applyUpdate(document, page.yState);
    else if (page.content) Y.applyUpdate(document, Y.encodeStateAsUpdate(jsonToYdoc(page.content)));
    this.state.set(documentName, { version: page.version, lastVector: Y.encodeStateVector(document) });
  }

  /**
   * 외부(REST) 변경 반영: DB version 이 마지막으로 알고 있는 값과 다르면 DB 상태를 메모리 문서에 병합한다.
   * 반환값: 반영 여부
   */
  async syncExternal(documentName: string, document: Y.Doc, row?: { version: number; yState: Uint8Array | null; content: unknown }): Promise<boolean> {
    const st = this.state.get(documentName);
    const pageId = parsePageId(documentName);
    if (!st || !pageId) return false;
    const page = row ?? (await this.prisma.page.findUnique({ where: { id: pageId }, select: { version: true, yState: true, content: true } }));
    if (!page || page.version === st.version) return false;
    if (page.yState) Y.applyUpdate(document, page.yState, 'external');
    else if (page.content) applyJsonToDoc(document, page.content);
    st.version = page.version;
    return true;
  }

  /** 저장: yState + JSON + 평문 + version++ + 증분 업데이트 기록 + 10분 간격 COLLAB 스냅샷 + 오래된 증분 정리 */
  async store(documentName: string, document: Y.Doc, userId: string | null): Promise<{ version: number; snapshot: boolean } | null> {
    const pageId = parsePageId(documentName);
    const st = this.state.get(documentName);
    if (!pageId || !st) return null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pages WHERE id = ${pageId}::uuid FOR UPDATE`;
      const page = await tx.page.findUnique({ where: { id: pageId }, select: { version: true, yState: true, content: true, title: true, deletedAt: true } });
      if (!page || page.deletedAt) return null;
      if (page.version !== st.version) await this.syncExternal(documentName, document, page);
      const content = sanitizeDoc(ydocToJson(document)) as Prisma.InputJsonObject;
      const version = page.version + 1;
      const diff = Y.encodeStateAsUpdate(document, st.lastVector);
      const full = Y.encodeStateAsUpdate(document);
      await tx.page.update({
        where: { id: pageId },
        data: { yState: toBytes(full), content, contentText: extractText(content), version, ...(userId ? { updatedById: userId } : {}) },
      });
      await tx.pageUpdate.create({ data: { pageId, update: toBytes(diff), userId } });
      const last = await tx.pageSnapshot.findFirst({ where: { pageId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      let snapshot = false;
      if (!last || Date.now() - last.createdAt.getTime() >= AUTO_SNAPSHOT_INTERVAL_MS) {
        const snap = await tx.pageSnapshot.create({
          data: { pageId, version, title: page.title, content, yState: toBytes(full), reason: 'COLLAB', createdById: userId },
          select: { createdAt: true },
        });
        // 스냅샷 이전 증분은 스냅샷(전체 상태)로 대체되므로 정리
        await tx.pageUpdate.deleteMany({ where: { pageId, createdAt: { lt: snap.createdAt } } });
        snapshot = true;
      }
      st.version = version;
      st.lastVector = Y.encodeStateVector(document);
      return { version, snapshot };
    });
  }

  /** 로드된 문서들의 외부 변경/삭제 확인 (주기 실행) */
  async poll(documents: Map<string, Y.Doc>): Promise<{ changed: string[]; deleted: string[] }> {
    const names = [...documents.keys()].filter((n) => this.state.has(n));
    const ids = names.map(parsePageId).filter(Boolean) as string[];
    if (!ids.length) return { changed: [], deleted: [] };
    const rows = await this.prisma.page.findMany({ where: { id: { in: ids } }, select: { id: true, version: true, deletedAt: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const changed: string[] = [];
    const deleted: string[] = [];
    for (const name of names) {
      const row = byId.get(parsePageId(name)!);
      if (!row || row.deletedAt) {
        deleted.push(name);
        continue;
      }
      if (row.version !== this.state.get(name)!.version) {
        if (await this.syncExternal(name, documents.get(name)!)) changed.push(name);
      }
    }
    return { changed, deleted };
  }

  forget(documentName: string) {
    this.state.delete(documentName);
  }
}
