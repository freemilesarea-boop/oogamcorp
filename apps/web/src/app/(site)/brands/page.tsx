import type { Metadata } from 'next';
import { getBrands, getPage, seoMetadata } from '@/components/site/data';
import { BrandCard, EmptyBlock, PageIntro, Unavailable } from '@/components/site/ui';


export async function generateMetadata(): Promise<Metadata> {
  const page = await getPage('brands');
  return seoMetadata({ seo: page?.seo, fallbackTitle: 'Brands', fallbackDescription: page?.content.lead ?? 'OOGAM과 함께하는 브랜드를 소개합니다.', path: '/brands' });
}

export default async function BrandsPage() {
  const [brands, page] = await Promise.all([getBrands(), getPage('brands')]);
  const c = page?.content;
  return (
    <>
      <PageIntro label={c?.label || 'Brands'} title={c?.heading || 'OOGAM과 함께하는 브랜드'} lead={c?.lead ?? 'AI 교육, AI 음악 미디어, AI 기술의 관점에서 함께 성장하는 브랜드를 소개합니다.'} />
      <section className="py-16 md:py-24">
        <div className="container-site">
          {brands === null ? (
            <Unavailable />
          ) : brands.length === 0 ? (
            <EmptyBlock title={c?.emptyTitle || '소개할 브랜드를 준비하고 있습니다.'} body={c?.emptyBody || '공개 준비가 완료된 브랜드부터 이곳에 소개됩니다.'} />
          ) : (
            <div className="grid grid-cols-1 border-l border-t border-gray-200 sm:grid-cols-2 lg:grid-cols-3">
              {brands.map((b, i) => <BrandCard key={b.id} brand={b} index={i} />)}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
