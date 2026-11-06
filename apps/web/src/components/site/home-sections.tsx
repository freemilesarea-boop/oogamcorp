import Link from 'next/link';
import { safeHref } from './markdown';
import type { Area, HomeContent, PublicBrand, PublicPortfolioItem, PublicPost } from './types';
import { ArrowLink, BrandCard, EmptyBlock, PortfolioCard, PostRow, SectionLabel } from './ui';

function linkOr(href: string | undefined, fallback: string) {
  return (href && safeHref(href)) || fallback;
}

/** Hero — 카피는 CMS(home.hero)에서. 게시본이 없으면 워드마크만 표시 */
export function Hero({ hero, name }: { hero: HomeContent['hero'] | undefined; name: string }) {
  const lines = hero?.lines?.filter(Boolean) ?? [];
  return (
    <section aria-label="소개" className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-ink text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px)] [background-size:calc(100%/12)_100%]" />
      <div className="container-site flex flex-1 flex-col justify-center pb-10 pt-32 md:pt-40">
        <div className="grid grid-cols-12 gap-x-6">
          {hero?.title && (
            <h1 className="col-span-12 animate-fade-up text-[clamp(3rem,9.5vw,9.75rem)] font-semibold leading-[0.92] tracking-[-0.055em] lg:col-span-11">
              {hero.title}
            </h1>
          )}
          {lines.length > 0 && (
            <ul className="col-span-12 mt-10 flex animate-fade-up flex-wrap gap-x-6 gap-y-2 text-xl font-medium tracking-[-0.02em] text-white/55 md:mt-14 md:text-3xl" style={{ animationDelay: '150ms' }}>
              {lines.map((l, i) => (
                <li key={i} className="flex items-center gap-6">
                  {i > 0 && <span aria-hidden className="hidden h-px w-8 bg-white/25 md:block" />}
                  {l}
                </li>
              ))}
            </ul>
          )}
          {hero?.ctaLabel && (
            <div className="col-span-12 mt-12 animate-fade-up md:mt-16" style={{ animationDelay: '300ms' }}>
              <Link
                href={linkOr(hero.ctaHref, '/contact')}
                className="group inline-flex h-12 items-center gap-3 rounded-full bg-white px-7 text-sm font-semibold text-ink transition-colors hover:bg-gray-200"
              >
                {hero.ctaLabel}
                <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </Link>
            </div>
          )}
        </div>
      </div>
      <div className="container-site overflow-hidden">
        <p
          aria-hidden={Boolean(hero?.title)}
          className="animate-fade-up select-none whitespace-nowrap text-[clamp(5rem,24vw,24rem)] font-bold leading-[0.78] tracking-[-0.07em] text-white"
          style={{ animationDelay: '220ms' }}
        >
          {hero?.eyebrow || name}
        </p>
      </div>
      <div className="h-6 md:h-10" />
    </section>
  );
}

export function Intro({ intro }: { intro: HomeContent['intro'] }) {
  if (!intro?.heading && !intro?.body) return null;
  return (
    <section className="py-24 md:py-40">
      <div className="container-site grid grid-cols-12 gap-x-6 gap-y-10">
        <div className="col-span-12 md:col-span-3"><SectionLabel index="01">Company</SectionLabel></div>
        <div className="col-span-12 md:col-span-9">
          {intro.heading && <h2 className="text-[clamp(2rem,4.6vw,4.25rem)] font-semibold leading-[1.08] tracking-[-0.04em]">{intro.heading}</h2>}
          {intro.body && <p className="mt-10 max-w-2xl whitespace-pre-line text-lg leading-relaxed text-gray-600 md:text-xl">{intro.body}</p>}
          <ArrowLink href="/about" className="mt-12">회사 소개</ArrowLink>
        </div>
      </div>
    </section>
  );
}

export function BusinessGrid({ areas, index = '02', withLink = true }: { areas: Area[] | undefined; index?: string; withLink?: boolean }) {
  const list = (areas ?? []).filter((a) => a.title);
  if (!list.length) return null;
  return (
    <section className="border-t border-gray-150 py-24 md:py-36">
      <div className="container-site">
        <div className="mb-14 flex items-end justify-between gap-6 md:mb-20">
          <SectionLabel index={index}>Business Areas</SectionLabel>
          <h2 className="sr-only">사업 영역</h2>
          {withLink && <ArrowLink href="/business" className="hidden md:inline-flex">사업 영역 전체</ArrowLink>}
        </div>
        <ol className="grid grid-cols-1 gap-px bg-gray-200 md:grid-cols-3">
          {list.map((a, i) => (
            <li key={a.key ?? i} className="group flex min-h-[18rem] flex-col justify-between bg-paper p-8 transition-colors duration-500 hover:bg-gray-50 md:min-h-[24rem] md:p-10">
              <span className="text-sm tabular-nums text-gray-500">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">{a.title}</h3>
                {a.body && <p className="mt-4 max-w-xs whitespace-pre-line text-[15px] leading-relaxed text-gray-600">{a.body}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function BrandsSection({ brands }: { brands: PublicBrand[] }) {
  return (
    <section className="border-t border-gray-150 py-24 md:py-36">
      <div className="container-site">
        <div className="mb-14 grid grid-cols-12 items-end gap-x-6 gap-y-6 md:mb-20">
          <div className="col-span-12 md:col-span-3"><SectionLabel index="03">Brands</SectionLabel></div>
          <h2 className="col-span-12 text-[clamp(2rem,4vw,3.5rem)] font-semibold leading-[1.1] tracking-[-0.04em] md:col-span-6">OOGAM과 함께하는 브랜드</h2>
          {brands.length > 0 && <div className="col-span-12 md:col-span-3 md:text-right"><ArrowLink href="/brands">브랜드 전체</ArrowLink></div>}
        </div>
        {brands.length > 0 ? (
          <div className="grid grid-cols-1 border-l border-t border-gray-200 sm:grid-cols-2 lg:grid-cols-3">
            {brands.slice(0, 6).map((b, i) => <BrandCard key={b.id} brand={b} index={i} />)}
          </div>
        ) : (
          <EmptyBlock title="소개할 브랜드를 준비하고 있습니다." body="공개 준비가 완료된 브랜드부터 이곳에 소개됩니다." />
        )}
      </div>
    </section>
  );
}

export function FeaturedSection({ items }: { items: PublicPortfolioItem[] }) {
  return (
    <section className="border-t border-gray-150 py-24 md:py-36">
      <div className="container-site">
        <div className="mb-14 flex items-end justify-between gap-6 md:mb-20">
          <div className="space-y-6">
            <SectionLabel index="04">Featured Projects</SectionLabel>
            <h2 className="text-[clamp(2rem,4vw,3.5rem)] font-semibold leading-[1.1] tracking-[-0.04em]">Selected Work</h2>
          </div>
          {items.length > 0 && <ArrowLink href="/portfolio" className="hidden md:inline-flex">포트폴리오 전체</ArrowLink>}
        </div>
        {items.length > 0 ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-16 md:grid-cols-2">
            {items.map((p, i) => (
              <div key={p.id} className={i % 2 === 1 ? 'md:mt-24' : undefined}><PortfolioCard item={p} /></div>
            ))}
          </div>
        ) : (
          <EmptyBlock title="공개된 프로젝트가 아직 없습니다." body="진행한 프로젝트를 정리해 곧 소개하겠습니다." />
        )}
      </div>
    </section>
  );
}

export function NewsSection({ posts }: { posts: PublicPost[] }) {
  return (
    <section className="border-t border-gray-150 py-24 md:py-36">
      <div className="container-site grid grid-cols-12 gap-x-6 gap-y-10">
        <div className="col-span-12 space-y-6 md:col-span-4">
          <SectionLabel index="05">News &amp; Insights</SectionLabel>
          <h2 className="text-[clamp(2rem,4vw,3.5rem)] font-semibold leading-[1.1] tracking-[-0.04em]">Latest</h2>
          {posts.length > 0 && <ArrowLink href="/news">전체 보기</ArrowLink>}
        </div>
        <div className="col-span-12 md:col-span-8">
          {posts.length > 0 ? (
            <ul className="border-b border-gray-200">{posts.map((p) => <PostRow key={p.id} post={p} />)}</ul>
          ) : (
            <EmptyBlock title="새 소식을 준비하고 있습니다." body="OOGAM의 소식과 인사이트가 이곳에 게시됩니다." />
          )}
        </div>
      </div>
    </section>
  );
}

export function CtaSection({ cta }: { cta: HomeContent['cta'] }) {
  return (
    <section className="px-3 pb-3 md:px-5 md:pb-5">
      <div className="rounded-[1.25rem] bg-ink text-white md:rounded-[2rem]">
        <div className="container-site grid grid-cols-12 gap-x-6 gap-y-12 py-24 md:py-36">
          <div className="col-span-12"><SectionLabel index="06" invert>Partnership</SectionLabel></div>
          <h2 className="col-span-12 text-[clamp(2.25rem,6vw,6rem)] font-semibold leading-[1.02] tracking-[-0.045em] lg:col-span-10">
            {cta?.heading || '함께 만들 프로젝트를 이야기해 주세요.'}
          </h2>
          <div className="col-span-12">
            <Link
              href={linkOr(cta?.href, '/contact')}
              className="group inline-flex h-14 items-center gap-4 rounded-full bg-white px-8 text-base font-semibold text-ink transition-colors hover:bg-gray-200"
            >
              {cta?.label || '문의하기'}
              <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
