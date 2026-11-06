import type { Metadata } from 'next';
import { ContactForm } from '@/components/site/contact-form';
import { getPage, seoMetadata } from '@/components/site/data';
import { PageIntro, SectionLabel } from '@/components/site/ui';


export async function generateMetadata(): Promise<Metadata> {
  const page = await getPage('contact');
  return seoMetadata({ seo: page?.seo, fallbackTitle: '문의', fallbackDescription: page?.content.body ?? '프로젝트·제휴·채용 문의', path: '/contact' });
}

export default async function ContactPage() {
  const page = await getPage('contact');
  const c = page?.content;
  const contacts: [string, string | undefined, string | undefined][] = [
    ['Email', c?.email, c?.email ? `mailto:${c.email}` : undefined],
    ['Phone', c?.phone, c?.phone ? `tel:${c.phone.replace(/[^0-9+]/g, '')}` : undefined],
    ['Address', c?.address, undefined],
  ];
  const shown = contacts.filter(([, v]) => v);
  return (
    <>
      <PageIntro label="Contact" title={c?.heading || 'Contact'} lead={c?.body} />
      <section className="py-16 md:py-28">
        <div className="container-site grid grid-cols-12 gap-x-6 gap-y-16">
          <aside className="col-span-12 space-y-10 lg:col-span-4">
            <SectionLabel>Get in touch</SectionLabel>
            {shown.length > 0 && (
              <dl className="space-y-6">
                {shown.map(([k, v, href]) => (
                  <div key={k}>
                    <dt className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{k}</dt>
                    <dd className="mt-1 text-lg">{href ? <a href={href} className="hover:underline">{v}</a> : v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </aside>
          <div className="col-span-12 lg:col-span-8">
            <ContactForm />
          </div>
        </div>
      </section>
    </>
  );
}
