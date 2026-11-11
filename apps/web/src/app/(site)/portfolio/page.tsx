import type { Metadata } from 'next';
import { getPage, getPortfolio, seoMetadata } from '@/components/site/data';
import { EmptyBlock, PageIntro, PortfolioCard, Unavailable } from '@/components/site/ui';


export async function generateMetadata(): Promise<Metadata> {
  const page = await getPage('portfolio');
  return seoMetadata({ seo: page?.seo, fallbackTitle: 'Portfolio', fallbackDescription: page?.content.lead ?? 'OOGAM이 기획·제작·운영한 프로젝트.', path: '/portfolio' });
}

export default async function PortfolioPage() {
  const [items, page] = await Promise.all([getPortfolio(), getPage('portfolio')]);
  const c = page?.content;
  return (
    <>
      <PageIntro label={c?.label || 'Portfolio'} title={c?.heading || 'Selected Work'} lead={c?.lead ?? 'AI 교육, AI 음악 미디어, AI 기술 영역에서 진행한 프로젝트입니다.'} />
      <section className="py-16 md:py-24">
        <div className="container-site">
          {items === null ? (
            <Unavailable />
          ) : items.length === 0 ? (
            <EmptyBlock title={c?.emptyTitle || '공개된 프로젝트가 아직 없습니다.'} body={c?.emptyBody || '진행한 프로젝트를 정리해 곧 소개하겠습니다.'} />
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
