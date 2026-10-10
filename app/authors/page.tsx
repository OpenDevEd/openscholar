import { EvidenceLibrariesGate } from "@/components/auth/evidence-libraries-gate";
import { AuthorList } from "@/components/authors/author-list";
import { PageWrapper } from "@/components/PageWrapper";
export default function Page() {
  return <EvidenceLibrariesGate fallback={<PageWrapper><AuthorList pending /></PageWrapper>}>
    <PageWrapper><AuthorList /></PageWrapper>
  </EvidenceLibrariesGate>;
}
