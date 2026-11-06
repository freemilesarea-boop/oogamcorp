import type { Metadata } from 'next';
import { getBrands, seoMetadata } from '@/components/site/data';
import { BrandCard, EmptyBlock, PageIntro, Unavailable } from '@/components/site/ui';


export const metadata: Metadata = seoMetadata({
  fallbackTitle: 'Brands',
  fallbackDescription: 'OOGAM과 함께하는 브랜드를 소개합니다.',
  path: '/brands',
});

export default async function BrandsPage() {
  const brands = await getBrands();
  return (
    <>
      <PageIntro label="Brands" title="OOGAM과 함께하는 브랜드" lead="크리에이티브, 미디어, 기술의 관점에서 함께 성장하는 브랜드를 소개합니다." />
      <section className="py-16 md:py-24">
        <div className="container-site">
          {brands === null ? (
            <Unavailable />
          ) : brands.length === 0 ? (
            <EmptyBlock title="소개할 브랜드를 준비하고 있습니다." body="공개 준비가 완료된 브랜드부터 이곳에 소개됩니다." />
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
