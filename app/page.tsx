import PageContent from '@/components/PageContent';
import { PageWrapper } from '@/components/PageWrapper';
import { getTranslations } from 'next-intl/server';
import { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  
  return {
    title: t('defaultTitle'),
    alternates: {
      canonical: t('siteUrl'),
    },
  };
}

export default async function Home() {
  const t = await getTranslations('metadata');
  
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": t('siteName'),
    "url": t('siteUrl'),
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": `${t('siteUrl')}/results?q={search_term_string}`
      },
      "query-input": "required name=search_term_string"
    }
  };

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
