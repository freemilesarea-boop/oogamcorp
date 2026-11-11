import type { Metadata } from 'next';
import { getPage, seoMetadata } from '@/components/site/data';
import { Markdown } from '@/components/site/markdown';
import { CmsImage, PageIntro, SectionLabel, Unavailable } from '@/components/site/ui';


export async function generateMetadata(): Promise<Metadata> {
  const page = await getPage('about');
  return seoMetadata({ seo: page?.seo, fallbackTitle: '회사 소개', fallbackDescription: page?.content.body?.slice(0, 150), path: '/about' });
}

export default async function AboutPage() {
  const page = await getPage('about');
  if (!page) {
    return (
      <>
        <PageIntro label="About" title="About OOGAM" />
        <div className="container-site py-16"><Unavailable /></div>
      </>
    );
  }
  const values = (page.content.values ?? []).filter((v) => v.title);
  return (
    <>
      <PageIntro label={page.content.label || 'About'} title={page.content.heading || page.title} lead={page.content.lead} />
      {page.content.imageUrl && (
        <div className="container-site pt-12">
          <CmsImage src={page.content.imageUrl} alt="" className="aspect-[16/9] w-full bg-gray-100 object-cover" />
        </div>
      )}
      {page.content.body && (
        <section className="py-20 md:py-32">
          <div className="container-site grid grid-cols-12 gap-x-6">
            <div className="col-span-12 mb-10 md:col-span-3 md:mb-0"><SectionLabel index="01">Who we are</SectionLabel></div>
            <Markdown source={page.content.body} size="lg" className="col-span-12 max-w-3xl md:col-span-8" />
          </div>
        </section>
      )}
      {values.length > 0 && (
        <section className="border-t border-gray-150 py-20 md:py-32">
          <div className="container-site">
            <SectionLabel index="02" className="mb-14">Values</SectionLabel>
            <ol className="grid grid-cols-1 gap-px bg-gray-200 md:grid-cols-2 lg:grid-cols-3">
              {values.map((v, i) => (
                <li key={i} className="bg-paper p-8 md:p-10">
                  <span className="text-sm tabular-nums text-gray-500">{String(i + 1).padStart(2, '0')}</span>
                  <h2 className="mt-10 text-2xl font-semibold tracking-tight md:text-3xl">{v.title}</h2>
                  {v.body && <p className="mt-4 whitespace-pre-line leading-relaxed text-gray-600">{v.body}</p>}
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}
    </>
  );
}
