import { Metadata } from "next";
import PageContent from '@/components/PageContent';
import { PageWrapper } from '@/components/PageWrapper';

export const metadata: Metadata = {
  title: "OpenScholar - Academic Paper Search",
  alternates: {
    canonical: "https://openscholar.ai",
  },
};

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "OpenScholar",
    "url": "https://openscholar.ai",
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": "https://openscholar.ai/results?q={search_term_string}"
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
