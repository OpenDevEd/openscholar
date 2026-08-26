import { ConfigurationWorkspace } from "@/components/evidence-libraries/configuration/configuration-workspace";
import { PageWrapper } from "@/components/PageWrapper";

export default async function EvidenceLibraryConfigurationPage({
  params,
}: {
  params: Promise<{ libraryId: string }>;
}) {
  const { libraryId } = await params;

  return (
    <PageWrapper>
      <ConfigurationWorkspace libraryId={libraryId} />
    </PageWrapper>
  );
}
