import { SetupProgress } from "@/components/evidence-libraries/mock/setup-progress";
import { PageWrapper } from "@/components/PageWrapper";

export default async function EvidenceLibrarySetupPage({
  params,
}: {
  params: Promise<{ libraryId: string }>;
}) {
  const { libraryId } = await params;

  return (
    <PageWrapper>
      <SetupProgress libraryId={libraryId} />
    </PageWrapper>
  );
}
