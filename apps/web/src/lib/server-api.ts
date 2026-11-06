import 'server-only';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * 서버 컴포넌트(공개 홈페이지)용 API 호출. 게시(PUBLISHED)된 콘텐츠만 반환하는 /public 엔드포인트를 사용한다.
 * API 가 응답하지 않으면 null 을 반환하고 페이지는 빈 상태를 렌더링한다(가짜 데이터로 대체하지 않음).
 *
 * 캐시하지 않는다(no-store): Next 데이터 캐시는 디스크에 남고 stale-while-revalidate 로 동작해,
 * 게시 취소·보관된 콘텐츠가 재시작 후에도 일시적으로 공개되는 문제가 있었다. 게시 상태 변경은 즉시 반영되어야 한다.
 * 트래픽 증가 시 Nginx 마이크로 캐시(수 초) 또는 게시 이벤트 기반 on-demand revalidate 로 확장한다.
 */
export async function publicFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}/api/v1/public${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const siteUrl = process.env.PUBLIC_SITE_URL ?? 'http://localhost:3000';
