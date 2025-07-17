"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { ScreeningPage } from '@/components/screening-page';

interface ScreeningResultsPageProps {
  params: Promise<{ searchId: string }>;
}

export default function ScreeningResultsPage({ params }: ScreeningResultsPageProps) {
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
    // Navigate back to specific search results
    router.push(`/results/${searchId}`);
  };

  return (
    <ScreeningPage 
      showBackButton={true}
      onBack={handleBack}
      searchId={searchId}
    />
  );
} 