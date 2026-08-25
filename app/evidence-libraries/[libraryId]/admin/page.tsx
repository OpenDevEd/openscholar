import { getTranslations } from "next-intl/server";
import { EvidenceLibraryAdminLaunch } from "@/components/evidence-libraries/evidence-library-admin-launch";
import { PageWrapper } from "@/components/PageWrapper";

export default async function EvidenceLibraryAdminPage({
  params,
}: {
  params: Promise<{ libraryId: string }>;
}) {
  const { libraryId } = await params;
  const t = await getTranslations("evidenceLibraryAdminLaunch");

  return (
    <PageWrapper>
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-primary">{t("eyebrow")}</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-muted-foreground">{t("description")}</p>
        </header>
        <EvidenceLibraryAdminLaunch libraryId={libraryId} />
      </main>
    </PageWrapper>
  );
}
