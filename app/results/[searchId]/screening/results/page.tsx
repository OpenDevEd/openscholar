"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { ScreeningResultsPage } from '@/components/screening-results-page';

interface ScreeningResultsPageProps {
  params: Promise<{ searchId: string }>;
}

export default function ScreeningResultsRootPage({ params }: ScreeningResultsPageProps) {
  const router = useRouter();
  const [searchId, setSearchId] = React.useState<string>('');

  React.useEffect(() => {
    const getSearchId = async () => {
      const resolvedParams = await params;
      setSearchId(resolvedParams.searchId);
    };
    getSearchId();
  }, [params]);

  const handleBack = () => {
    router.push(`/results/${searchId}/screening`);
  };


  return (
    <ScreeningResultsPage
      showBackButton={true}
      onBack={handleBack}
      searchId={searchId}
    />
  );
} 