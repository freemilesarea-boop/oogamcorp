import Link from 'next/link';
import { safeHref } from './markdown';
import type { SiteInfo } from './types';

/**
 * 푸터 — 회사 정보는 CMS '사이트 공통 정보(site)' 페이지에서만 가져온다.
 * 게시된 정보가 없으면 항목을 표시하지 않는다 (임의 정보 노출 금지).
 */
export function SiteFooter({ site }: { site: SiteInfo | null }) {
  const f = site?.footer ?? null;
  const year = new Date().getFullYear();
  const nav = site?.nav ?? [];
  const info: [string, string | undefined][] = [
    ['상호', f?.companyName],
    ['대표', f?.ceo],
    ['사업자등록번호', f?.businessNumber],
    ['주소', f?.address],
    ['이메일', f?.email],
    ['전화', f?.phone],
  ];
  const shown = info.filter(([, v]) => v && v.trim());
  const socials = (f?.socials ?? []).filter((s) => s.label && s.href && safeHref(s.href));

  return (
    <footer className="bg-ink text-white">
      <div className="container-site grid grid-cols-12 gap-y-12 py-16 md:py-24">
        <div className="col-span-12 md:col-span-5">
          <p className="text-3xl font-bold tracking-[-0.04em] md:text-4xl">OOGAM</p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/60">{f?.tagline || 'Ideas Become Impact.'}</p>
        </div>
        <nav aria-label="푸터 메뉴" className="col-span-6 md:col-span-3">
          <p className="mb-4 text-[11px] uppercase tracking-[0.2em] text-white/60">Menu</p>
          <ul className="space-y-2.5 text-sm">
            {nav.map((n) => (
              <li key={n.href}><Link href={n.href} className="text-white/75 transition-colors hover:text-white">{n.label}</Link></li>
            ))}
          </ul>
        </nav>
        <div className="col-span-6 md:col-span-4">
          <p className="mb-4 text-[11px] uppercase tracking-[0.2em] text-white/60">Connect</p>
          {socials.length > 0 ? (
            <ul className="space-y-2.5 text-sm">
              {socials.map((s) => (
                <li key={s.href}>
                  <a href={safeHref(s.href!)!} target="_blank" rel="noopener noreferrer" className="text-white/75 transition-colors hover:text-white">{s.label} ↗</a>
                </li>
              ))}
            </ul>
          ) : (
            <Link href="/contact" className="text-sm text-white/75 transition-colors hover:text-white">문의하기 →</Link>
          )}
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container-site flex flex-col gap-6 py-8 text-xs text-white/60 md:flex-row md:items-end md:justify-between">
          {shown.length > 0 ? (
            <dl className="flex flex-wrap gap-x-5 gap-y-1.5">
              {shown.map(([k, v]) => (
                <div key={k} className="flex gap-1.5"><dt className="text-white/30">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          ) : <span />}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/privacy" className="font-medium text-white/70 hover:text-white">개인정보처리방침</Link>
            <Link href="/terms" className="hover:text-white">이용약관</Link>
            <span>{f?.copyright || `© ${year} OOGAM. All rights reserved.`}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
