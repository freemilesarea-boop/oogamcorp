import 'server-only';
import { loadBackend } from './cms-backend';
import { staticFetch } from './static-site/static-fetch';

const POST_TYPES = new Set(['NEWS', 'INSIGHT', 'CAREER']);
const int = (v: string | null, d: number, min: number, max: number) => {
  const n = Number(v ?? d);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : d;
};

/**
 * CMS 모드의 공개 데이터 조회 — HTTP 왕복 없이 같은 프로세스의 PublicSiteService 를 호출한다.
 * 경로 형식은 /api/v1/public 과 동일. 없음(404)은 null, 그 외 오류는 로그 후 null(빈 상태 렌더링).
 * preview=true 는 호출자가 세션(cms.read)을 검증한 경우에만 전달한다.
 */
export async function cmsFetch(path: string, preview: boolean): Promise<unknown> {
  const url = new URL(path, 'http://cms');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const q = url.searchParams;
  const opts = { preview };
  try {
    const svc = await (await loadBackend()).publicSite();
    let result: unknown;
    switch (parts[0]) {
      case 'site': result = await svc.site(opts); break;
      case 'home': result = await svc.home(opts); break;
      case 'pages': result = parts[1] ? await svc.page(parts[1], opts) : null; break;
      case 'business-areas': result = parts[1] ? await svc.businessArea(parts[1], opts) : await svc.businessAreas(opts); break;
      case 'brands': result = parts[1] ? await svc.brand(parts[1], opts) : await svc.brands(opts); break;
      case 'portfolio': {
        const featured = q.get('featured');
        result = await svc.portfolio({ brand: q.get('brand') ?? undefined, featured: featured === 'true' || featured === 'false' ? featured : undefined }, opts);
        break;
      }
      case 'posts': {
        if (parts[1] && parts[2]) {
          result = POST_TYPES.has(parts[1]) ? await svc.post(parts[1] as 'NEWS', parts[2], opts) : null;
          break;
        }
        const type = q.get('type');
        result = await svc.posts(
          { type: type && POST_TYPES.has(type) ? (type as 'NEWS') : undefined, page: int(q.get('page'), 1, 1, 10_000), pageSize: int(q.get('pageSize'), 12, 1, 50) },
          opts,
        );
        break;
      }
      case 'sitemap': result = await svc.sitemap(); break;
      default: return null;
    }
    // Date → ISO 문자열 (공개 API JSON 응답과 동일한 형태)
    return result == null ? null : JSON.parse(JSON.stringify(result));
  } catch (e) {
    const status = (e as { status?: number; getStatus?: () => number }).getStatus?.() ?? (e as { status?: number }).status;
    if (status === 404) return null;
    // DB·백엔드 장애 시 공개 홈페이지가 비지 않도록 번들된 정적 콘텐츠로 대체 (관리자 기능에는 영향 없음)
    console.error('[cms-fetch] 조회 실패 → 정적 콘텐츠로 대체', path, String((e as Error)?.message ?? e).replace(/(postgres(?:ql)?:\/\/)[^@\s]*@/gi, '$1***@'));
    return preview ? null : staticFetch(path);
  }
}
