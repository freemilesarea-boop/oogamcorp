import snapshot from './snapshot.json';

/**
 * 정적 사이트 모드(백엔드 미연결 배포)용 공개 데이터.
 * Preview 환경의 공개 API 응답을 스냅샷한 가상 샘플 데이터이며 읽기 전용이다.
 * 실제 기업 정보가 확정되면 백엔드(CMS) 연결로 대체한다.
 */
type Snap = typeof snapshot;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const snap = snapshot as Snap & Record<string, Any>;

export function staticFetch(path: string): unknown {
  const url = new URL(path, 'http://static');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const q = url.searchParams;
  switch (parts[0]) {
    case 'site':
      return snap.site;
    case 'home':
      return snap.home;
    case 'pages':
      return (snap.pages as Record<string, Any>)[parts[1]] ?? null;
    case 'brands':
      return parts[1] ? (snap.brandDetail as Record<string, Any>)[parts[1]] ?? null : snap.brands;
    case 'portfolio': {
      const brand = q.get('brand');
      return brand ? (snap.portfolio as Any[]).filter((p) => p.brand?.slug === brand) : snap.portfolio;
    }
    case 'posts': {
      const posts = snap.posts as Any[];
      if (parts[1] && parts[2]) return posts.find((p) => p.type === parts[1] && p.slug === parts[2]) ?? null;
      const type = q.get('type');
      const page = Math.max(1, Number(q.get('page') ?? 1));
      const pageSize = Math.min(50, Math.max(1, Number(q.get('pageSize') ?? 12)));
      const list = posts
        .filter((p) => (type ? p.type === type : p.type !== 'CAREER'))
        .map(({ body: _body, ...rest }) => rest)
        .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
      return { items: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize, totalPages: Math.max(1, Math.ceil(list.length / pageSize)) };
    }
    case 'sitemap':
      return snap.sitemap;
    default:
      return null;
  }
}
