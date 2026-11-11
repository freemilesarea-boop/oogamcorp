/** 미리보기 대상은 공개 사이트 내부 경로만 (관리자·API·외부 URL 금지 → 오픈 리다이렉트 방지) */
export function safePreviewPath(raw: string | null): string {
  const p = (raw ?? '/').trim();
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\') || p.length > 500) return '/';
  if (/^\/(admin|api|_next)(\/|$)/.test(p)) return '/';
  return p;
}

/** 같은 출처 상대 경로로 리다이렉트 (프록시·호스트명 차이에 영향받지 않음) */
export function relativeRedirect(location: string): Response {
  return new Response(null, { status: 307, headers: { Location: location, 'Cache-Control': 'no-store' } });
}
