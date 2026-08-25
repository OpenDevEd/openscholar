import { EvidenceLibraryAdminLaunch } from "@/components/evidence-libraries/evidence-library-admin-launch";
import { PageWrapper } from "@/components/PageWrapper";

export default async function EvidenceLibraryAdminPage({
  params,
}: {
  params: Promise<{ libraryId: string }>;
}) {
  const { libraryId } = await params;

  return (
    <PageWrapper>
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <EvidenceLibraryAdminLaunch libraryId={libraryId} />
      </main>
    </PageWrapper>
  );
}
