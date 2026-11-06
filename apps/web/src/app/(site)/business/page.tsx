import type { Metadata } from 'next';
import { getPage, seoMetadata } from '@/components/site/data';
import { BusinessGrid } from '@/components/site/home-sections';
import { Markdown } from '@/components/site/markdown';
import { ArrowLink, PageIntro, Unavailable } from '@/components/site/ui';

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPage('business');
  return seoMetadata({ seo: page?.seo, fallbackTitle: '사업 영역', fallbackDescription: page?.content.body?.slice(0, 150), path: '/business' });
}

export default async function BusinessPage() {
  const page = await getPage('business');
  if (!page) {
    return (
      <>
        <PageIntro label="Business" title="Business" />
        <div className="container-site py-16"><Unavailable /></div>
      </>
    );
  }
  return (
    <>
      <PageIntro label="Business" title={page.content.heading || page.title} />
      {page.content.body && (
        <section className="py-20 md:py-28">
          <div className="container-site grid grid-cols-12 gap-x-6">
            <Markdown source={page.content.body} size="lg" className="col-span-12 max-w-3xl md:col-span-8 md:col-start-4" />
          </div>
        </section>
      )}
      <BusinessGrid areas={page.content.areas} index="01" withLink={false} />
      <section className="border-t border-gray-150 py-20">
        <div className="container-site flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <p className="text-2xl font-semibold tracking-tight md:text-3xl">프로젝트를 함께 논의해 보세요.</p>
          <ArrowLink href="/contact">문의하기</ArrowLink>
        </div>
      </section>
    </>
  );
}
