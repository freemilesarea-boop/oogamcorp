import { NextResponse, type NextRequest } from 'next/server';

/**
 * UX 용 1차 리다이렉트: 세션 쿠키가 없으면 로그인으로 보낸다.
 * 실제 인증/권한 검증은 API 서버가 모든 요청에서 수행한다.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const open = pathname.startsWith('/admin/login') || pathname.startsWith('/admin/accept-invite');
  const hasSession = req.cookies.has('oogam_session') || req.cookies.has('__Host-oogam_session');
  if (!open && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const config = { matcher: ['/admin', '/admin/:path*'] };
