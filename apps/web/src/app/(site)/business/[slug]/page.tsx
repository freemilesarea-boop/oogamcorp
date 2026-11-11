import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { excerptOf, getBusinessArea, getBusinessAreas, seoMetadata } from '@/components/site/data';
import { Markdown, safeHref } from '@/components/site/markdown';
import { CmsImage, SectionLabel } from '@/components/site/ui';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const area = await getBusinessArea(decodeURIComponent(slug));
  if (!area) return { title: '사업 영역을 찾을 수 없습니다', robots: { index: false } };
  return seoMetadata({
    seo: { title: area.seoTitle, description: area.seoDescription },
    fallbackTitle: area.title,
    fallbackDescription: area.summary ?? excerptOf(area.body),
    path: `/business/${encodeURIComponent(area.slug)}`,
    image: area.imageUrl,
  });
}

export default async function BusinessAreaPage({ params }: Props) {
  const { slug } = await params;
  // 미게시·삭제된 사업 영역은 API 가 null → 404
  const [area, all] = await Promise.all([getBusinessArea(decodeURIComponent(slug)), getBusinessAreas()]);
  if (!area) notFound();
  const others = (all ?? []).filter((a) => a.slug !== area.slug);
  const cta = area.ctaLabel ? safeHref(area.ctaHref || '/contact') : null;

  return (
    <>
      <section className="border-b border-gray-150 pb-14 pt-32 md:pb-20 md:pt-44">
        <div className="container-site grid grid-cols-12 gap-x-6 gap-y-8">
          <nav aria-label="경로" className="col-span-12 text-xs text-gray-500">
            <Link href="/business" className="hover:text-ink">Business</Link>
            <span aria-hidden className="mx-2">/</span>
            <span aria-current="page">{area.title}</span>
          </nav>
          <div className="col-span-12 animate-fade-up lg:col-span-10">
            {area.subtitle && <p className="mb-5 text-sm font-medium uppercase tracking-[0.2em] text-gray-500">{area.subtitle}</p>}
            <h1 className="text-[clamp(2.75rem,8vw,7rem)] font-semibold leading-[0.95] tracking-[-0.05em]">{area.title}</h1>
          </div>
          {area.summary && <p className="col-span-12 text-xl leading-relaxed text-gray-600 md:col-span-8 md:text-2xl">{area.summary}</p>}
          {area.highlights.length > 0 && (
            <ul className="col-span-12 flex flex-wrap gap-2" aria-label="핵심 키워드">
              {area.highlights.map((h) => (
                <li key={h} className="rounded-full border border-gray-300 px-4 py-1.5 text-sm text-gray-700">{h}</li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {area.imageUrl && (
        <div className="container-site pt-12">
          <CmsImage src={area.imageUrl} alt={`${area.title} 대표 이미지`} className="aspect-[16/9] w-full bg-gray-100 object-cover" />
        </div>
      )}
      {area.body && (
        <section className="py-20 md:py-28">
          <div className="container-site grid grid-cols-12 gap-x-6">
            <div className="col-span-12 mb-10 md:col-span-3 md:mb-0"><SectionLabel>Overview</SectionLabel></div>
            <Markdown source={area.body} size="lg" className="col-span-12 max-w-3xl md:col-span-8" />
          </div>
        </section>
      )}
      {cta && (
        <section className="px-3 pb-3 md:px-5 md:pb-5">
          <div className="rounded-[1.25rem] bg-ink text-white md:rounded-[2rem]">
            <div className="container-site flex flex-col items-start justify-between gap-8 py-16 md:flex-row md:items-center md:py-24">
              <p className="text-2xl font-semibold tracking-tight md:text-4xl">{area.title} 관련 문의</p>
              <Link
                href={cta}
                className="group inline-flex h-14 items-center gap-4 rounded-full bg-white px-8 text-base font-semibold text-ink transition-colors hover:bg-gray-200"
              >
                {area.ctaLabel}
                <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </Link>
            </div>
          </div>
        </section>
      )}
      {others.length > 0 && (
        <section className="border-t border-gray-150 py-16 md:py-24">
          <div className="container-site">
            <SectionLabel className="mb-10">Other Business Areas</SectionLabel>
            <ul className="grid grid-cols-1 gap-px bg-gray-200 md:grid-cols-2">
              {others.map((o) => (
                <li key={o.slug} className="flex">
                  <Link href={`/business/${encodeURIComponent(o.slug)}`} className="group flex w-full items-center justify-between bg-paper p-8 transition-colors hover:bg-gray-50">
                    <span>
                      {o.subtitle && <span className="block text-sm text-gray-500">{o.subtitle}</span>}
                      <span className="text-2xl font-semibold tracking-tight">{o.title}</span>
                    </span>
                    <span aria-hidden className="text-xl transition-transform duration-300 group-hover:translate-x-1">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <div className="container-site pb-24 pt-8">
        <Link href="/business" className="text-sm font-medium text-gray-500 hover:text-ink">← 모든 사업 영역</Link>
      </div>
    </>
  );
}
