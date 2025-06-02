import ResultsPageContent from '@/components/results-page-content';

export default async function ResultsPage({ params }: { params: Promise<{ searchId: string }> }) {
  const { searchId } = await params;
  return <ResultsPageContent searchId={searchId} />;
} 