import { JoinOrganization } from "@/components/workspaces/join";

// Where an invitation to an organization links (#651).
export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <JoinOrganization slug={slug} />;
}
