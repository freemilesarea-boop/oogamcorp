import { NextResponse, type NextRequest } from 'next/server';

/**
 * 1) 모든 페이지에 요청별 nonce 기반 Content-Security-Policy 적용 (공개 사이트 + 관리자)
 * 2) 관리자 영역: 세션 쿠키가 없으면 로그인으로 리다이렉트 (UX 용, 실제 인증·권한은 API 가 강제)
 */
export function buildCsp(nonce: string, opts: { dev: boolean; collabUrl?: string; https?: boolean }) {
  const connect = ["'self'"];
  if (opts.collabUrl) {
    try {
      const u = new URL(opts.collabUrl);
      connect.push(`${u.protocol}//${u.host}`);
    } catch {
      /* 잘못된 설정은 무시 */
    }
  }
  if (opts.dev) connect.push('ws:', 'wss:');
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // strict-dynamic: nonce 가 부여된 Next.js 런타임이 로드하는 청크만 실행 허용
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    // Tailwind/Radix/Tiptap 의 인라인 style 속성 때문에 스타일은 unsafe-inline 허용 (스크립트 실행 불가, 위험도 낮음)
    'style-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
    'connect-src': connect,
    'media-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'frame-src': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  // HTTPS 로 서비스될 때만 (HTTP 스테이징에서 하위 리소스가 https 로 강제 전환되어 깨지는 것 방지)
  if (opts.https) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/** 상수 시간 문자열 비교 (Edge 런타임) */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 선택적 사이트 접근 비밀번호 (SITE_ACCESS_PASSWORD, 서버 환경변수 — Git 에 저장하지 않음).
 * 설정된 경우 모든 요청에 HTTP Basic 인증을 요구한다. 사용자명은 무엇이든 허용.
 */
function accessDenied(req: NextRequest): NextResponse | null {
  const expected = process.env.SITE_ACCESS_PASSWORD;
  if (!expected) return null;
  const header = req.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (safeEqual(password, expected)) return null;
    } catch {
      /* 잘못된 헤더 */
    }
  }
  return new NextResponse('인증이 필요합니다.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="OOGAM Preview", charset="UTF-8"', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' },
  });
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/');

  const denied = accessDenied(req);
  if (denied) return denied;

  // 백엔드 미연결 배포: 관리자·내부 API 는 서버에서 차단 (메뉴 숨김이 아닌 요청 자체 거부)
  if (process.env.NEXT_PUBLIC_DATA_SOURCE === 'static') {
    if (isAdmin) {
      return new NextResponse('Not Found', { status: 404, headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { statusCode: 503, message: '이 배포에는 백엔드가 연결되어 있지 않습니다.' },
        { status: 503, headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' } },
      );
    }
  }
  // 백엔드 연결 배포: API 요청은 그대로 통과 (API 자체 보안 헤더 사용)
  if (pathname.startsWith('/api/')) return NextResponse.next();

  if (isAdmin) {
    const open = pathname.startsWith('/admin/login') || pathname.startsWith('/admin/accept-invite') || pathname.startsWith('/admin/mfa');
    const hasSession = req.cookies.has('oogam_session') || req.cookies.has('__Host-oogam_session');
    if (!open && !hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin/login';
      url.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
  }

  const nonce = btoa(crypto.randomUUID());
  const https = req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:';
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== 'production', collabUrl: process.env.NEXT_PUBLIC_COLLAB_URL, https });
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  // Preview 빌드는 모든 페이지 색인 금지 (robots.txt·meta 와 함께 3중 적용)
  if (isAdmin || process.env.NEXT_PUBLIC_SITE_MODE === 'preview') res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (isAdmin) {
    res.headers.set('Cache-Control', 'no-store');
  }
  return res;
}

export const config = {
  matcher: [
    // 정적 자산·API·이미지 최적화 경로 제외 (prefetch 요청 제외)
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
