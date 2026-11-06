import type { Metadata } from 'next';
import { getPortfolio, seoMetadata } from '@/components/site/data';
import { EmptyBlock, PageIntro, PortfolioCard, Unavailable } from '@/components/site/ui';

export const revalidate = 60;

export const metadata: Metadata = seoMetadata({
  fallbackTitle: 'Portfolio',
  fallbackDescription: 'OOGAM이 기획·제작·운영한 프로젝트.',
  path: '/portfolio',
});

export default async function PortfolioPage() {
  const items = await getPortfolio();
  return (
    <>
      <PageIntro label="Portfolio" title="Selected Work" lead="크리에이티브 비즈니스, 미디어, 테크놀로지 영역에서 진행한 프로젝트입니다." />
      <section className="py-16 md:py-24">
        <div className="container-site">
          {items === null ? (
            <Unavailable />
          ) : items.length === 0 ? (
            <EmptyBlock title="공개된 프로젝트가 아직 없습니다." body="진행한 프로젝트를 정리해 곧 소개하겠습니다." />
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-16 md:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => <PortfolioCard key={p.id} item={p} />)}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
