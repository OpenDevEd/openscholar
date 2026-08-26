import { EvidenceLibraryConfigurationShell } from "@/components/evidence-libraries/configuration/evidence-library-configuration-shell";
import { PageWrapper } from "@/components/PageWrapper";
import {
  readEnum,
  readStringContract,
} from "@/lib/evidence-libraries/configuration/form-contract";

export default async function EvidenceLibraryConfigurationPage({
  params,
}: {
  params: Promise<{ libraryId: string }>;
}) {
  const { libraryId } = await params;
  const formContract = {
    fields: {
      name: readStringContract("/identity/name"),
      shortName: readStringContract("/identity/shortName"),
      tagline: readStringContract("/identity/tagline"),
      description: readStringContract("/identity/description"),
      logo: readStringContract("/identity/assets/logoDark"),
      favicon: readStringContract("/identity/assets/favicon"),
      shareImage: readStringContract("/identity/assets/shareImage"),
      colour: readStringContract("/theme/colors/accent"),
    },
    locales: readEnum("/localization/locales"),
  };

  return (
    <PageWrapper>
      <EvidenceLibraryConfigurationShell
        formContract={formContract}
        libraryId={libraryId}
      />
    </PageWrapper>
  );
}
