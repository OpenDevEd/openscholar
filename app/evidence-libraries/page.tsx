import { auth } from "@clerk/nextjs/server";
import { preloadQuery } from "convex/nextjs";
import { OrganizationFeatureGate } from "@/components/auth/organization-feature-gate";
import { LibraryList } from "@/components/evidence-libraries/library-list";
import { PageWrapper } from "@/components/PageWrapper";
import { api } from "@/convex/_generated/api";

export default async function EvidenceLibrariesPage() {
  // Whether the viewer may create a library arrives with the page, so New library is there from the first frame.
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const organizations = await preloadQuery(api.organizationFeatures.libraryOrganizations, {}, { token });
  return (
    <OrganizationFeatureGate feature="evidenceLibraries" fallback={<PageWrapper><LibraryList pending preloadedOrganizations={organizations} /></PageWrapper>}>
      <PageWrapper><LibraryList preloadedOrganizations={organizations} /></PageWrapper>
    </OrganizationFeatureGate>
  );
}
