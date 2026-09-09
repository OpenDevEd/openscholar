import { OrganizationFeatureGate } from "@/components/auth/organization-feature-gate";
import { LibraryList } from "@/components/evidence-libraries/library-list";
import { PageWrapper } from "@/components/PageWrapper";

export default function EvidenceLibrariesPage() {
  return (
    <OrganizationFeatureGate feature="evidenceLibraries"><PageWrapper>
      <LibraryList />
    </PageWrapper></OrganizationFeatureGate>
  );
}
