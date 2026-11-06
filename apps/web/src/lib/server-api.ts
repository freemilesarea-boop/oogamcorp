import 'server-only';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * 서버 컴포넌트(공개 홈페이지)용 API 호출. 게시(PUBLISHED)된 콘텐츠만 반환하는 /public 엔드포인트를 사용한다.
 * API 가 응답하지 않으면 null 을 반환하고 페이지는 빈 상태를 렌더링한다(가짜 데이터로 대체하지 않음).
 */
export async function publicFetch<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const res = await fetch(`${API}/api/v1/public${path}`, { next: { revalidate, tags: ['public'] } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const siteUrl = process.env.PUBLIC_SITE_URL ?? 'http://localhost:3000';
