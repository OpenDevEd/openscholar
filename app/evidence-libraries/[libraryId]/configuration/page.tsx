import { EvidenceLibraryConfigurationShell } from "@/components/evidence-libraries/configuration/evidence-library-configuration-shell";
import { PageWrapper } from "@/components/PageWrapper";

export default async function EvidenceLibraryConfigurationPage({
  params,
}: {
  params: Promise<{ libraryId: string }>;
}) {
  const { libraryId } = await params;

  return (
    <PageWrapper>
      <EvidenceLibraryConfigurationShell libraryId={libraryId} />
    </PageWrapper>
  );
}
