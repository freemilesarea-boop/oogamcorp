import type { Metadata } from 'next';
import { getHome, getSite, seoMetadata } from '@/components/site/data';
import { BrandsSection, BusinessGrid, CtaSection, FeaturedSection, Hero, Intro, NewsSection, toAreaCards } from '@/components/site/home-sections';


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
      <Hero hero={content?.hero} name={site?.name ?? 'OOGAM'} />
      <Intro intro={content?.intro} />
      <BusinessGrid areas={home?.businessAreas?.length ? home.businessAreas : toAreaCards(content?.business)} />
      <BrandsSection brands={home?.brands ?? []} />
      <FeaturedSection items={home?.featured ?? []} />
      <NewsSection posts={home?.news ?? []} />
      <CtaSection cta={content?.cta} />
      <div className="h-16 md:h-24" />
    </>
  );
}
