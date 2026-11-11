import { getSite } from '@/components/site/data';
import { SiteFooter } from '@/components/site/site-footer';
import { SiteHeader } from '@/components/site/site-header';
import { previewViewer } from '@/lib/cms-preview';

/**
 * 공개 페이지는 요청 시 렌더링한다(빌드 시점에 API 가 없어도 빈 페이지가 캐시되지 않도록).
 * API 응답은 publicFetch 의 데이터 캐시(revalidate 60초)로 캐싱된다.
 */
export const dynamic = 'force-dynamic';

const FALLBACK_NAV = [
  { href: '/about', label: 'About' },
  { href: '/business', label: 'Business' },
  { href: '/brands', label: 'Brands' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/news', label: 'News' },
  { href: '/careers', label: 'Careers' },
  { href: '/contact', label: 'Contact' },
];

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [site, viewer] = await Promise.all([getSite(), previewViewer()]);
  const nav = site?.nav?.length ? site.nav : FALLBACK_NAV;
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <a
        href="#main"
        className="sr-only z-[60] rounded bg-ink px-4 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        본문으로 바로가기
      </a>
      {viewer && (
        <div role="status" className="fixed inset-x-0 bottom-0 z-[70] flex items-center justify-center gap-4 bg-amber-400 px-4 py-2.5 text-sm font-medium text-ink shadow-lg">
          <span>미리보기 중 — 게시 전 초안이 포함된 화면입니다 ({viewer.name})</span>
          <a href="/admin/preview/exit" className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">미리보기 종료</a>
        </div>
      )}
      <SiteHeader nav={nav} cta={site?.cta} />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter site={site ? { ...site, nav } : { name: 'OOGAM', nav, footer: null, seo: { title: null, description: null, ogImageUrl: null } }} />
    </div>
  );
}
