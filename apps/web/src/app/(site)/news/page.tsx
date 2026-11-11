import type { Metadata } from 'next';
import Link from 'next/link';
import { getPage, getPosts, seoMetadata } from '@/components/site/data';
import { EmptyBlock, PageIntro, PostRow, Unavailable } from '@/components/site/ui';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPage('news');
  return seoMetadata({ seo: page?.seo, fallbackTitle: 'News & Insights', fallbackDescription: page?.content.lead ?? 'OOGAM의 소식과 인사이트.', path: '/news' });
}

const TABS = [
  { key: undefined, label: 'All' },
  { key: 'NEWS', label: 'News' },
  { key: 'INSIGHT', label: 'Insight' },
] as const;

type Props = { searchParams: Promise<{ type?: string; page?: string }> };

function href(type: string | undefined, page?: number) {
  const sp = new URLSearchParams();
  if (type) sp.set('type', type);
  if (page && page > 1) sp.set('page', String(page));
  const s = sp.toString();
  return s ? `/news?${s}` : '/news';
}

export default async function NewsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const type = sp.type === 'NEWS' || sp.type === 'INSIGHT' ? sp.type : undefined;
  const page = Math.max(1, Math.min(1000, Number.parseInt(sp.page ?? '1', 10) || 1));
  const [data, intro] = await Promise.all([getPosts(type, page, 10), getPage('news')]);
  const c = intro?.content;

  return (
    <>
      <PageIntro label={c?.label || 'Newsroom'} title={c?.heading || 'News & Insights'} lead={c?.lead} />
      <section className="py-14 md:py-20">
        <div className="container-site">
          <nav aria-label="게시물 유형" className="mb-10 flex gap-2">
            {TABS.map((t) => {
              const active = t.key === type;
              return (
                <Link
                  key={t.label}
                  href={href(t.key)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-full border px-5 py-2 text-sm font-medium transition-colors',
                    active ? 'border-ink bg-ink text-white' : 'border-gray-200 text-gray-600 hover:border-ink hover:text-ink',
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
          {data === null ? (
            <Unavailable />
          ) : data.items.length === 0 ? (
            <EmptyBlock title={c?.emptyTitle || '게시된 글이 아직 없습니다.'} body={c?.emptyBody || 'OOGAM의 소식과 인사이트가 이곳에 게시됩니다.'} />
          ) : (
            <>
              <ul className="border-b border-gray-200">{data.items.map((p) => <PostRow key={p.id} post={p} />)}</ul>
              {data.totalPages > 1 && (
                <nav aria-label="페이지" className="mt-12 flex items-center justify-between text-sm">
                  {page > 1 ? <Link href={href(type, page - 1)} className="font-medium hover:underline">← 이전</Link> : <span />}
                  <span className="tabular-nums text-gray-500">{page} / {data.totalPages}</span>
                  {page < data.totalPages ? <Link href={href(type, page + 1)} className="font-medium hover:underline">다음 →</Link> : <span />}
                </nav>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
