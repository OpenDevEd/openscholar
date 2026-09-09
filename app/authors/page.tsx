import { OrganizationFeatureGate } from "@/components/auth/organization-feature-gate";
import { AuthorList } from "@/components/authors/author-list";
import { PageWrapper } from "@/components/PageWrapper";
export default function Page() { return <OrganizationFeatureGate feature="authors"><PageWrapper><AuthorList /></PageWrapper></OrganizationFeatureGate>; }
