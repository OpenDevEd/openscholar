import PageContent from '@/components/PageContent';
import { PageWrapper } from '@/components/PageWrapper';
import { getTranslations } from 'next-intl/server';
import { Metadata } from 'next';
import { indexedPage, SITE_URL } from '@/lib/seo/page-metadata';
import { ORGANIZATION } from '@/lib/seo/organization';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return indexedPage({ path: '/', title: t('defaultTitle'), description: t('defaultDescription') });
}

export default async function Home() {
  const t = await getTranslations('metadata');

  // The site's name as Google shows it, published by the one Openscholar the marketing site names too.
  const jsonLd = [
    { "@context": "https://schema.org", "@type": "WebSite", name: t('siteName'), url: SITE_URL, publisher: { "@id": ORGANIZATION["@id"] } },
    { "@context": "https://schema.org", ...ORGANIZATION },
  ];

  return (
    <PageWrapper>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PageContent />
    </PageWrapper>
  );
}
