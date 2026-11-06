import Link from 'next/link';
import { cn } from '@/lib/utils';
import { EMPLOYMENT_TYPE_LABELS, POST_TYPE_LABELS, type CareerMeta, type PublicBrand, type PublicPortfolioItem, type PublicPost } from './types';

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/** 섹션 라벨 — "01 / About" */
export function SectionLabel({ index, children, className, invert }: { index?: string; children: React.ReactNode; className?: string; invert?: boolean }) {
  return (
    <p className={cn('flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.22em]', invert ? 'text-white/50' : 'text-gray-500', className)}>
      {index && <span className={cn('tabular-nums', invert ? 'text-white' : 'text-ink')}>{index}</span>}
      {index && <span aria-hidden className={cn('h-px w-8', invert ? 'bg-white/30' : 'bg-gray-300')} />}
      <span>{children}</span>
    </p>
  );
}

/** 하위 페이지 상단 타이틀 */
export function PageIntro({ label, title, lead, children }: { label: string; title: string; lead?: string | null; children?: React.ReactNode }) {
  return (
    <section className="border-b border-gray-150 pb-14 pt-32 md:pb-20 md:pt-44">
      <div className="container-site grid grid-cols-12 gap-x-6 gap-y-8">
        <div className="col-span-12 animate-fade-up">
          <SectionLabel>{label}</SectionLabel>
        </div>
        <h1 className="col-span-12 animate-fade-up text-[clamp(2.5rem,7vw,6.5rem)] font-semibold leading-[0.95] tracking-[-0.045em] text-ink lg:col-span-10" style={{ animationDelay: '80ms' }}>
          {title}
        </h1>
        {lead && (
          <p className="col-span-12 animate-fade-up whitespace-pre-line text-lg leading-relaxed text-gray-600 md:col-span-8 md:text-xl lg:col-span-6 lg:col-start-7" style={{ animationDelay: '160ms' }}>
            {lead}
          </p>
        )}
        {children && <div className="col-span-12">{children}</div>}
      </div>
    </section>
  );
}

/** 콘텐츠 없음 — 가짜 데이터 대신 정돈된 빈 상태 */
export function EmptyBlock({ title, body, invert, className }: { title: string; body?: string; invert?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-col items-start gap-3 border-t py-14 md:py-20', invert ? 'border-white/15' : 'border-gray-200', className)}>
      <p className={cn('text-xl font-medium tracking-tight md:text-2xl', invert ? 'text-white' : 'text-ink')}>{title}</p>
      {body && <p className={cn('max-w-lg text-sm leading-relaxed md:text-base', invert ? 'text-white/50' : 'text-gray-500')}>{body}</p>}
    </div>
  );
}

/** API 응답 불가 */
export function Unavailable() {
  return <EmptyBlock title="콘텐츠를 불러오지 못했습니다." body="잠시 후 다시 시도해 주세요." />;
}

export function ArrowLink({ href, children, invert, className }: { href: string; children: React.ReactNode; invert?: boolean; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'group inline-flex items-center gap-3 text-sm font-medium tracking-wide',
        invert ? 'text-white' : 'text-ink',
        className,
      )}
    >
      <span className="border-b border-current pb-0.5">{children}</span>
      <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
    </Link>
  );
}

/** 외부 URL 이미지 (CMS 입력) — 지연 로딩 일반 img */
export function CmsImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={className} />;
}

export function BrandCard({ brand, index }: { brand: PublicBrand; index: number }) {
  return (
    <Link
      href={`/brands/${encodeURIComponent(brand.slug)}`}
      className="group relative flex aspect-[4/3] flex-col justify-between border-b border-r border-gray-200 bg-paper p-6 transition-colors duration-500 hover:bg-ink hover:text-white md:p-8"
    >
      <div className="flex items-start justify-between text-[11px] uppercase tracking-[0.2em] text-gray-500 group-hover:text-white/50">
        <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>
        {brand.category && <span>{brand.category}</span>}
      </div>
      <div className="flex flex-1 items-center justify-center py-6">
        {brand.logoUrl ? (
          <CmsImage src={brand.logoUrl} alt={`${brand.name} 로고`} className="max-h-16 max-w-[70%] object-contain transition duration-500 group-hover:invert" />
        ) : (
          <span className="text-center text-3xl font-semibold tracking-[-0.03em] md:text-4xl">{brand.name}</span>
        )}
      </div>
      <div className="flex items-end justify-between gap-4">
        <p className="line-clamp-2 text-sm text-gray-500 group-hover:text-white/70">{brand.tagline ?? brand.name}</p>
        <span aria-hidden className="translate-x-0 opacity-0 transition duration-300 group-hover:translate-x-1 group-hover:opacity-100">→</span>
      </div>
    </Link>
  );
}

export function PortfolioCard({ item, priority }: { item: PublicPortfolioItem; priority?: boolean }) {
  return (
    <article className="group">
      <div className="relative aspect-[4/3] overflow-hidden bg-gray-100">
        {item.imageUrl ? (
          <CmsImage src={item.imageUrl} alt={item.title} className="size-full object-cover transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:scale-[1.03]" />
        ) : (
          <div className="flex size-full items-end bg-gray-100 p-6">
            <span className="text-2xl font-semibold tracking-[-0.03em] text-gray-300">{item.title}</span>
          </div>
        )}
        {priority && <span className="sr-only">주요 프로젝트</span>}
      </div>
      <div className="mt-5 flex items-start justify-between gap-6">
        <div>
          <h3 className="text-lg font-semibold tracking-tight md:text-xl">{item.title}</h3>
          {item.summary && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-500">{item.summary}</p>}
        </div>
        <div className="shrink-0 text-right text-xs text-gray-500">
          {item.year && <p className="tabular-nums">{item.year}</p>}
          {item.brand && (
            <Link href={`/brands/${encodeURIComponent(item.brand.slug)}`} className="mt-1 block underline-offset-4 hover:text-ink hover:underline">
              {item.brand.name}
            </Link>
          )}
        </div>
      </div>
      {(item.client || item.tags.length > 0) && (
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.14em] text-gray-500">
          {item.client && <span>{item.client}</span>}
          {item.tags.map((t) => <span key={t}>#{t}</span>)}
        </p>
      )}
    </article>
  );
}

export function postHref(post: Pick<PublicPost, 'type' | 'slug'>) {
  return post.type === 'CAREER' ? `/careers/${encodeURIComponent(post.slug)}` : `/news/${encodeURIComponent(post.slug)}`;
}

export function PostRow({ post, invert }: { post: PublicPost; invert?: boolean }) {
  return (
    <li>
      <Link
        href={postHref(post)}
        className={cn(
          'group grid grid-cols-12 items-baseline gap-x-6 gap-y-2 border-t py-7 transition-colors md:py-9',
          invert ? 'border-white/15 hover:bg-white/[0.03]' : 'border-gray-200 hover:bg-gray-50',
        )}
      >
        <span className={cn('col-span-6 text-xs tabular-nums md:col-span-2', invert ? 'text-white/50' : 'text-gray-500')}>{formatDate(post.publishedAt)}</span>
        <span className={cn('col-span-6 text-right text-[11px] uppercase tracking-[0.2em] md:order-last md:col-span-2', invert ? 'text-white/50' : 'text-gray-500')}>
          {POST_TYPE_LABELS[post.type]}
        </span>
        <span className="col-span-12 md:col-span-8">
          <span className="block text-xl font-medium tracking-tight transition-transform duration-300 group-hover:translate-x-1 md:text-2xl">{post.title}</span>
          {post.excerpt && <span className={cn('mt-2 line-clamp-2 block text-sm', invert ? 'text-white/55' : 'text-gray-500')}>{post.excerpt}</span>}
        </span>
      </Link>
    </li>
  );
}

export function CareerMetaList({ meta, className }: { meta: CareerMeta; className?: string }) {
  const items: [string, string | undefined][] = [
    ['근무지', meta.location],
    ['고용 형태', meta.employmentType ? EMPLOYMENT_TYPE_LABELS[meta.employmentType] ?? meta.employmentType : undefined],
    ['팀', meta.team],
    ['경력', meta.experience],
    ['마감', meta.deadline ? meta.deadline.replaceAll('-', '.') : '상시 채용'],
  ];
  return (
    <dl className={cn('flex flex-wrap gap-x-6 gap-y-1 text-sm', className)}>
      {items.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="flex gap-2"><dt className="text-gray-500">{k}</dt><dd className="text-gray-700">{v}</dd></div>
      ))}
    </dl>
  );
}

export function isClosed(meta: CareerMeta): boolean {
  if (!meta.deadline) return false;
  const end = new Date(`${meta.deadline}T23:59:59+09:00`);
  return !Number.isNaN(+end) && end.getTime() < Date.now();
}
