import PageContent from '@/components/PageContent';
import { PageWrapper } from '@/components/PageWrapper';
import { getTranslations } from 'next-intl/server';
import { Metadata } from 'next';
import { indexedPage } from '@/lib/seo/page-metadata';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return indexedPage({ path: '/', title: t('defaultTitle'), description: t('defaultDescription') });
}

export default async function Home() {
  const t = await getTranslations('metadata');

  // The site's name and logo as Google shows them.
  const jsonLd = [
    { "@context": "https://schema.org", "@type": "WebSite", name: t('siteName'), url: t('siteUrl') },
    { "@context": "https://schema.org", "@type": "Organization", name: t('siteName'), url: t('siteUrl'), logo: `${t('siteUrl')}/web-app-manifest-512x512.png` },
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
