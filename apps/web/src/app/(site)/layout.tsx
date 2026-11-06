import { getSite } from '@/components/site/data';
import { SiteFooter } from '@/components/site/site-footer';
import { SiteHeader } from '@/components/site/site-header';

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
  const site = await getSite();
  const nav = site?.nav?.length ? site.nav : FALLBACK_NAV;
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <a
        href="#main"
        className="sr-only z-[60] rounded bg-ink px-4 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        본문으로 바로가기
      </a>
      <SiteHeader nav={nav} />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter site={site ? { ...site, nav } : { name: 'OOGAM', nav, footer: null, seo: { title: null, description: null, ogImageUrl: null } }} />
    </div>
  );
}
