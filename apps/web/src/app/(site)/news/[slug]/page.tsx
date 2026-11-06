import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { excerptOf, getPost, seoMetadata } from '@/components/site/data';
import { Markdown } from '@/components/site/markdown';
import { CmsImage, formatDate } from '@/components/site/ui';
import { POST_TYPE_LABELS } from '@/components/site/types';


type Props = { params: Promise<{ slug: string }> };

/** /news/[slug] 는 NEWS → INSIGHT 순으로 조회 (유형별 슬러그 고유) */
async function load(slug: string) {
  const s = decodeURIComponent(slug);
  return (await getPost('NEWS', s)) ?? (await getPost('INSIGHT', s));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await load((await params).slug);
  if (!post) return { title: '게시물을 찾을 수 없습니다', robots: { index: false } };
  return seoMetadata({
    seo: { title: post.seoTitle ?? null, description: post.seoDescription ?? null },
    fallbackTitle: post.title,
    fallbackDescription: post.excerpt ?? excerptOf(post.body),
    path: `/news/${encodeURIComponent(post.slug)}`,
    image: post.coverImageUrl,
    type: 'article',
  });
}

export default async function NewsDetailPage({ params }: Props) {
  const post = await load((await params).slug);
  if (!post) notFound();
  return (
    <article>
      <header className="pb-12 pt-32 md:pb-16 md:pt-44">
        <div className="container-site grid grid-cols-12 gap-x-6 gap-y-8">
          <p className="col-span-12 flex gap-4 text-xs uppercase tracking-[0.2em] text-gray-500 md:col-span-8 md:col-start-3">
            <Link href={`/news?type=${post.type}`} className="hover:text-ink">{POST_TYPE_LABELS[post.type]}</Link>
            <time dateTime={post.publishedAt} className="tabular-nums">{formatDate(post.publishedAt)}</time>
          </p>
          <h1 className="col-span-12 animate-fade-up text-[clamp(2.25rem,5vw,4.5rem)] font-semibold leading-[1.05] tracking-[-0.04em] md:col-span-10 md:col-start-3">
            {post.title}
          </h1>
          {post.excerpt && <p className="col-span-12 text-xl leading-relaxed text-gray-600 md:col-span-8 md:col-start-3">{post.excerpt}</p>}
        </div>
      </header>
      {post.coverImageUrl && (
        <div className="container-site">
          <CmsImage src={post.coverImageUrl} alt="" className="aspect-[16/9] w-full bg-gray-100 object-cover" />
        </div>
      )}
      <div className="container-site grid grid-cols-12 gap-x-6 py-16 md:py-24">
        <Markdown source={post.body} className="col-span-12 md:col-span-8 md:col-start-3" />
      </div>
      <div className="container-site grid grid-cols-12 border-t border-gray-150 py-10">
        <Link href="/news" className="col-span-12 text-sm font-medium text-gray-500 hover:text-ink md:col-start-3">← 목록으로</Link>
      </div>
    </article>
  );
}
