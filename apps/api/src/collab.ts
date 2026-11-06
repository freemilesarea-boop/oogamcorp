import './config/env-loader';
import 'reflect-metadata';
import { Server } from '@hocuspocus/server';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config/configuration';
import { CollabPersistence, type CollabContext } from './modules/documents/collab-persistence';

/**
 * OOGAM 실시간 공동 편집 서버 (Hocuspocus v2 / Yjs). API 와 별도 프로세스로 실행한다.
 *
 * - 문서 이름: `page:<uuid>`
 * - 인증: 웹소켓 업그레이드 요청의 세션 쿠키(oogam_session / __Host-oogam_session)만 사용한다.
 *   토큰 파라미터 인증은 허용하지 않는다(클라이언트는 Hocuspocus 인증 핸드셰이크를 위해 임의 문자열을 보낼 뿐 서버는 무시).
 *   Origin 헤더를 WEB_ORIGINS 와 대조해 교차 사이트 웹소켓 탈취(CSWSH)를 막는다.
 * - 권한: 문서 접근 수준 EDIT 이상 → 편집, VIEW/COMMENT → 읽기 전용 연결, 그 외 거부.
 * - 저장: onStoreDocument (debounce 2초, 최대 10초) → yState/JSON/평문/version 갱신 + page_updates 증분 기록
 *   + 10분 간격 COLLAB 스냅샷 + 스냅샷 이전 증분 정리.
 * - 재연결/충돌: Yjs CRDT 가 병합한다. 클라이언트(HocuspocusProvider)는 자동 재연결 후 상태 벡터를 교환해
 *   오프라인 중 편집분을 포함한 누락 업데이트만 주고받는다. REST 를 통한 외부 변경(버전 복원 등)은
 *   5초 주기 폴링으로 감지해 접속 중인 문서에 병합한다(CollabPersistence.syncExternal).
 * - 상태 확인: GET /health → {"status":"ok"} (그 외 HTTP 요청은 기본 "OK")
 *
 * 알려진 제한: 연결 중 세션이 폐기돼도 기존 연결은 유지된다(다음 연결부터 거부).
 */
const cfg = loadConfig();
const prisma = new PrismaClient();
const cookieNames = [...new Set([cfg.cookie.sessionName, 'oogam_session', '__Host-oogam_session'])];
const persistence = new CollabPersistence(prisma, cfg.webOrigins, cookieNames);
const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), service: 'collab', msg, ...extra }));

const server = Server.configure({
  name: 'oogam-collab',
  port: cfg.collabPort,
  address: '0.0.0.0',
  quiet: true,
  debounce: 2000,
  maxDebounce: 10_000,
  timeout: 30_000,
  stopOnSignals: false,

  async onListen() {
    log(`OOGAM collab listening on :${cfg.collabPort} (${cfg.env})`);
  },

  async onRequest({ request, response }) {
    if (request.url?.startsWith('/health')) {
      await prisma.$queryRaw`SELECT 1`;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', documents: server.getDocumentsCount(), connections: server.getConnectionsCount() }));
      // 기본 응답을 막기 위해 빈 reject
      return Promise.reject();
    }
  },

  async onAuthenticate({ documentName, requestHeaders, connection }): Promise<CollabContext> {
    try {
      const ctx = await persistence.authenticate({ documentName, headers: requestHeaders });
      if (ctx.readOnly) connection.readOnly = true;
      return ctx;
    } catch (e) {
      log('auth rejected', { documentName, reason: (e as Error).message });
      throw e;
    }
  },

  async onLoadDocument({ documentName, document }) {
    await persistence.load(documentName, document);
    return document;
  },

  async onStoreDocument({ documentName, document, context }) {
    const ctx = context as CollabContext | undefined;
    try {
      const res = await persistence.store(documentName, document, ctx?.userId ?? null);
      if (res?.snapshot) log('snapshot created', { documentName, version: res.version });
    } catch (e) {
      log('store failed', { documentName, error: (e as Error).message });
      throw e;
    }
  },

  async afterUnloadDocument({ documentName }) {
    persistence.forget(documentName);
  },
});

// 외부 변경(REST 버전 복원 등)·삭제 감지
const pollTimer = setInterval(() => {
  persistence
    .poll(server.documents)
    .then(({ changed, deleted }) => {
      for (const name of changed) log('external change merged', { documentName: name });
      for (const name of deleted) {
        log('document deleted, closing connections', { documentName: name });
        server.closeConnections(name);
      }
    })
    .catch((e) => log('poll failed', { error: (e as Error).message }));
}, 5000);

void server.listen();

async function shutdown(signal: string) {
  log(`received ${signal}, shutting down`);
  clearInterval(pollTimer);
  try {
    await server.destroy(); // 미저장 문서 저장 후 종료
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
