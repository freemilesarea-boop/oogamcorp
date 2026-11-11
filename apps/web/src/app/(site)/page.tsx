import type { Metadata } from 'next';
import { getHome, getSite, seoMetadata } from '@/components/site/data';
import { HomeSections, toAreaCards } from '@/components/site/home-sections';


export async function generateMetadata(): Promise<Metadata> {
  const home = await getHome();
  return seoMetadata({
    seo: home?.page?.seo,
    fallbackTitle: 'OOGAM — Ideas Become Impact.',
    fallbackDescription: home?.page?.content.intro?.body ?? 'OOGAM — AI Education. AI Music Media. AI Technology.',
    path: '/',
  });
}

export default async function HomePage() {
  const [home, site] = await Promise.all([getHome(), getSite()]);
  const content = home?.page?.content;
  return (
    <>
      <HomeSections
        content={content}
        name={site?.name ?? 'OOGAM'}
        businessAreas={home?.businessAreas?.length ? home.businessAreas : toAreaCards(content?.business)}
        brands={home?.brands ?? []}
        featured={home?.featured ?? []}
        news={home?.news ?? []}
      />
      <div className="h-16 md:h-24" />
    </>
  );
}
