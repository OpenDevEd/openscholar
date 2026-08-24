import { EvidenceLibraryConfigurationShell } from "@/components/evidence-libraries/configuration/evidence-library-configuration-shell";
import { PageWrapper } from "@/components/PageWrapper";
import { getEssentialConfigurationFormContract } from "@/lib/evidence-libraries/configuration/form-contract";

export default async function EvidenceLibraryConfigurationPage({
  params,
}: {
  params: Promise<{ libraryId: string }>;
}) {
  const { libraryId } = await params;
  const formContract = getEssentialConfigurationFormContract();

  return (
    <PageWrapper>
      <EvidenceLibraryConfigurationShell
        formContract={formContract}
        libraryId={libraryId}
      />
    </PageWrapper>
  );
}
