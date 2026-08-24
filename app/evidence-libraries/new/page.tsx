import { CreateEvidenceLibraryStep } from "@/components/evidence-libraries/create-evidence-library-step";
import { PageWrapper } from "@/components/PageWrapper";
import { getTranslations } from "next-intl/server";

export default async function NewEvidenceLibraryPage() {
  const t = await getTranslations("evidenceLibrarySetup");

  return (
    <PageWrapper>
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-primary">{t("eyebrow")}</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            {t("description")}
          </p>
        </header>
        <CreateEvidenceLibraryStep />
      </main>
    </PageWrapper>
  );
}
