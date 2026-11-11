import type { NextRequest } from 'next/server';
import { loadBackend } from '@/lib/cms-backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** 전달하지 않는 홉 단위 헤더 */
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer', 'host']);

/**
 * CMS 모드: /api/v1/* 를 같은 함수 안에서 구동 중인 NestJS(인증·CMS·공개 사이트, 루프백 전용 포트)로 전달한다.
 * 인증·CSRF·Origin·권한·입력 검증·감사 로그는 Nest 의 기존 전역 가드/파이프가 그대로 처리한다.
 * 허용 경로는 미들웨어에서 먼저 제한된다 (사내 업무 시스템 API 는 404).
 */
async function proxy(req: NextRequest): Promise<Response> {
  if (process.env.NEXT_PUBLIC_DATA_SOURCE !== 'cms') {
    return Response.json({ statusCode: 404, message: 'Not Found' }, { status: 404 });
  }
  try {
    const port = await (await loadBackend()).internalPort();
    const headers = new Headers();
    req.headers.forEach((v, k) => {
      if (!HOP.has(k)) headers.set(k, v);
    });
    // Origin 검사·클라이언트 IP 판별용 원래 요청 정보
    headers.set('x-forwarded-host', req.headers.get('x-forwarded-host') ?? req.nextUrl.host);
    headers.set('x-forwarded-proto', req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', ''));
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const upstream = await fetch(`http://127.0.0.1:${port}${req.nextUrl.pathname}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual',
      // @ts-expect-error Node fetch 스트리밍 요청 본문
      duplex: hasBody ? 'half' : undefined,
    });
    const out = new Headers();
    upstream.headers.forEach((v, k) => {
      if (!HOP.has(k) && k !== 'set-cookie' && k !== 'content-encoding') out.set(k, v);
    });
    for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (e) {
    console.error('[cms-backend] 요청 처리 실패', (e as Error).message);
    return Response.json({ statusCode: 503, message: '일시적으로 서비스를 이용할 수 없습니다.' }, { status: 503 });
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS, proxy as HEAD };
