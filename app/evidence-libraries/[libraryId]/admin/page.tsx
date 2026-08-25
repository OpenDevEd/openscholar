import { AdminLaunch } from "@/components/evidence-libraries/mock/admin-launch";
import { PageWrapper } from "@/components/PageWrapper";

export default async function EvidenceLibraryAdminPage({
  params,
}: {
  params: Promise<{ libraryId: string }>;
}) {
  const { libraryId } = await params;

  return (
    <PageWrapper>
      <AdminLaunch libraryId={libraryId} />
    </PageWrapper>
  );
}
