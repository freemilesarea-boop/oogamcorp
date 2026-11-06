import type { Metadata } from 'next';
import { getPage, seoMetadata } from './data';
import { Markdown } from './markdown';
import { formatDate, PageIntro, Unavailable } from './ui';

export async function legalMetadata(key: string, title: string, path: string): Promise<Metadata> {
  const page = await getPage(key);
  return seoMetadata({ seo: page?.seo, fallbackTitle: title, path });
}

/** 개인정보처리방침·이용약관 — CMS 게시본 그대로 (법무 검토 문구 포함) */
export async function LegalPage({ pageKey, label, fallbackTitle }: { pageKey: string; label: string; fallbackTitle: string }) {
  const page = await getPage(pageKey);
  return (
    <>
      <PageIntro label={label} title={page?.content.heading || page?.title || fallbackTitle} />
      <section className="py-16 md:py-24">
        <div className="container-site grid grid-cols-12 gap-x-6">
          <aside className="col-span-12 mb-10 text-sm text-gray-500 md:col-span-3 md:mb-0">
            {page?.content.effectiveDate && <p>시행일 {page.content.effectiveDate}</p>}
            {page?.publishedAt && <p className="mt-1">최종 게시 {formatDate(page.publishedAt)}</p>}
          </aside>
          <div className="col-span-12 max-w-3xl md:col-span-8">
            {page ? <Markdown source={page.content.body} /> : <Unavailable />}
          </div>
        </div>
      </section>
    </>
  );
}
