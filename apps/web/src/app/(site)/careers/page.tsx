import type { Metadata } from 'next';
import Link from 'next/link';
import { getPage, getPosts, seoMetadata } from '@/components/site/data';
import { Markdown } from '@/components/site/markdown';
import { CareerMetaList, EmptyBlock, isClosed, PageIntro, postHref, SectionLabel, Unavailable } from '@/components/site/ui';


export async function generateMetadata(): Promise<Metadata> {
  const page = await getPage('careers');
  return seoMetadata({ seo: page?.seo, fallbackTitle: '채용', fallbackDescription: 'OOGAM과 함께할 동료를 찾습니다.', path: '/careers' });
}

export default async function CareersPage() {
  const [page, jobs] = await Promise.all([getPage('careers'), getPosts('CAREER', 1, 50)]);
  return (
    <>
      <PageIntro label={page?.content.label || 'Careers'} title={page?.content.heading || 'Careers'} lead={page?.content.lead} />
      {page?.content.body && (
        <section className="py-16 md:py-24">
          <div className="container-site grid grid-cols-12 gap-x-6">
            <Markdown source={page.content.body} size="lg" className="col-span-12 max-w-3xl md:col-span-8 md:col-start-4" />
          </div>
        </section>
      )}
      <section className="border-t border-gray-150 py-16 md:py-24">
        <div className="container-site">
          <SectionLabel index="01" className="mb-10">Open Positions</SectionLabel>
          {jobs === null ? (
            <Unavailable />
          ) : jobs.items.length === 0 ? (
            <EmptyBlock title={page?.content.emptyTitle || '현재 진행 중인 채용이 없습니다.'} body={page?.content.emptyBody || '새로운 포지션이 열리면 이곳에 안내합니다. 자유 지원은 문의 페이지를 이용해 주세요.'} />
          ) : (
            <ul className="border-b border-gray-200">
              {jobs.items.map((job) => {
                const closed = isClosed(job.metadata ?? {});
                return (
                  <li key={job.id}>
                    <Link href={postHref(job)} className="group grid grid-cols-12 items-center gap-x-6 gap-y-3 border-t border-gray-200 py-8 transition-colors hover:bg-gray-50">
                      <div className="col-span-12 md:col-span-7">
                        <h2 className="text-2xl font-medium tracking-tight transition-transform duration-300 group-hover:translate-x-1 md:text-3xl">{job.title}</h2>
                        {job.excerpt && <p className="mt-2 line-clamp-1 text-sm text-gray-500">{job.excerpt}</p>}
                      </div>
                      <CareerMetaList meta={job.metadata ?? {}} className="col-span-10 md:col-span-4" />
                      <span className="col-span-2 text-right text-xs md:col-span-1">
                        {closed ? <span className="text-gray-500">마감</span> : <span aria-hidden>→</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
