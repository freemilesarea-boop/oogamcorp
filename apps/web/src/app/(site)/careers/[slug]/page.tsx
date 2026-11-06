import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { excerptOf, getPost, seoMetadata } from '@/components/site/data';
import { Markdown, safeHref } from '@/components/site/markdown';
import { CareerMetaList, isClosed } from '@/components/site/ui';

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPost('CAREER', decodeURIComponent((await params).slug));
  if (!post) return { title: '채용 공고를 찾을 수 없습니다', robots: { index: false } };
  return seoMetadata({
    seo: { title: post.seoTitle ?? null, description: post.seoDescription ?? null },
    fallbackTitle: post.title,
    fallbackDescription: post.excerpt ?? excerptOf(post.body),
    path: `/careers/${encodeURIComponent(post.slug)}`,
    type: 'article',
  });
}

export default async function CareerDetailPage({ params }: Props) {
  const post = await getPost('CAREER', decodeURIComponent((await params).slug));
  if (!post) notFound();
  const meta = post.metadata ?? {};
  const closed = isClosed(meta);
  const apply = meta.applyUrl ? safeHref(meta.applyUrl) : null;
  return (
    <article>
      <header className="border-b border-gray-150 pb-12 pt-32 md:pb-16 md:pt-44">
        <div className="container-site grid grid-cols-12 gap-x-6 gap-y-8">
          <nav aria-label="경로" className="col-span-12 text-xs text-gray-500">
            <Link href="/careers" className="hover:text-ink">Careers</Link>
            <span aria-hidden className="mx-2">/</span>
            <span aria-current="page">{post.title}</span>
          </nav>
          <h1 className="col-span-12 animate-fade-up text-[clamp(2.25rem,5vw,4.5rem)] font-semibold leading-[1.05] tracking-[-0.04em] md:col-span-10">{post.title}</h1>
          <CareerMetaList meta={meta} className="col-span-12" />
        </div>
      </header>
      <div className="container-site grid grid-cols-12 gap-x-6 gap-y-12 py-16 md:py-24">
        <Markdown source={post.body} className="col-span-12 md:col-span-8" />
        <aside className="col-span-12 md:col-span-3 md:col-start-10">
          <div className="sticky top-28 space-y-4 border-t border-ink pt-6">
            {closed ? (
              <p className="text-sm text-gray-500">마감된 공고입니다.</p>
            ) : (
              <a
                href={apply ?? '/contact'}
                {...(apply && /^https?:/i.test(apply) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="flex h-12 w-full items-center justify-center rounded-full bg-ink text-sm font-semibold text-white transition-opacity hover:opacity-85"
              >
                지원하기
              </a>
            )}
            <Link href="/careers" className="block text-sm text-gray-500 hover:text-ink">← 전체 포지션</Link>
          </div>
        </aside>
      </div>
    </article>
  );
}
