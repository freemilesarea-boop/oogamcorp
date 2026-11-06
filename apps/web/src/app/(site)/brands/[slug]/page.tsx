import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { excerptOf, getBrand, seoMetadata } from '@/components/site/data';
import { Markdown, safeHref } from '@/components/site/markdown';
import { CmsImage, PortfolioCard, SectionLabel } from '@/components/site/ui';

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrand(decodeURIComponent(slug));
  if (!brand) return { title: '브랜드를 찾을 수 없습니다', robots: { index: false } };
  return seoMetadata({
    seo: { title: brand.seoTitle, description: brand.seoDescription },
    fallbackTitle: brand.name,
    fallbackDescription: brand.tagline ?? excerptOf(brand.description),
    path: `/brands/${encodeURIComponent(brand.slug)}`,
    image: brand.imageUrl ?? brand.logoUrl,
  });
}

export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  // 미게시/삭제 브랜드는 API 가 404 → notFound
  const brand = await getBrand(decodeURIComponent(slug));
  if (!brand) notFound();
  const website = brand.websiteUrl ? safeHref(brand.websiteUrl) : null;

  return (
    <>
      <section className="border-b border-gray-150 pb-14 pt-32 md:pb-20 md:pt-44">
        <div className="container-site grid grid-cols-12 gap-x-6 gap-y-8">
          <nav aria-label="경로" className="col-span-12 text-xs text-gray-500">
            <Link href="/brands" className="hover:text-ink">Brands</Link>
            <span aria-hidden className="mx-2">/</span>
            <span aria-current="page">{brand.name}</span>
          </nav>
          <div className="col-span-12 flex animate-fade-up items-center gap-6 lg:col-span-9">
            {brand.logoUrl && <CmsImage src={brand.logoUrl} alt="" className="size-16 shrink-0 object-contain md:size-24" />}
            <h1 className="text-[clamp(2.75rem,8vw,7rem)] font-semibold leading-[0.95] tracking-[-0.05em]">{brand.name}</h1>
          </div>
          <div className="col-span-12 flex flex-col justify-end gap-4 text-sm lg:col-span-3 lg:items-end">
            {brand.category && <span className="text-[11px] uppercase tracking-[0.2em] text-gray-500">{brand.category}</span>}
            {website && (
              <a href={website} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4 hover:text-gray-500">
                웹사이트 방문 ↗
              </a>
            )}
          </div>
          {brand.tagline && <p className="col-span-12 text-xl leading-relaxed text-gray-600 md:col-span-8 md:text-2xl">{brand.tagline}</p>}
        </div>
      </section>
      {brand.imageUrl && (
        <div className="container-site pt-12">
          <CmsImage src={brand.imageUrl} alt={`${brand.name} 대표 이미지`} className="aspect-[16/9] w-full bg-gray-100 object-cover" />
        </div>
      )}
      {brand.description && (
        <section className="py-20 md:py-28">
          <div className="container-site grid grid-cols-12 gap-x-6">
            <div className="col-span-12 mb-10 md:col-span-3 md:mb-0"><SectionLabel>About the brand</SectionLabel></div>
            <Markdown source={brand.description} size="lg" className="col-span-12 max-w-3xl md:col-span-8" />
          </div>
        </section>
      )}
      {brand.portfolio.length > 0 && (
        <section className="border-t border-gray-150 py-20 md:py-28">
          <div className="container-site">
            <SectionLabel className="mb-12">Projects</SectionLabel>
            <div className="grid grid-cols-1 gap-x-6 gap-y-14 md:grid-cols-2 lg:grid-cols-3">
              {brand.portfolio.map((p) => <PortfolioCard key={p.id} item={p} />)}
            </div>
          </div>
        </section>
      )}
      <div className="container-site pb-24 pt-8">
        <Link href="/brands" className="text-sm font-medium text-gray-500 hover:text-ink">← 모든 브랜드</Link>
      </div>
    </>
  );
}
