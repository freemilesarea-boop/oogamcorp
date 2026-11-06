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

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/');

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
  if (isAdmin) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    res.headers.set('Cache-Control', 'no-store');
  }
  return res;
}

export const config = {
  matcher: [
    // 정적 자산·API·이미지 최적화 경로 제외 (prefetch 요청 제외)
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
