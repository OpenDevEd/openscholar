import { JoinOrganization } from "@/components/workspaces/join";

// Where an invitation to an organization links (#651). Its parameter isn't `slug`: that one marks a
// page as in the organization's workspace (lib/workspaces/href.ts), and someone invited isn't in it yet.
export default async function JoinPage({ params }: { params: Promise<{ organization: string }> }) {
  const { organization } = await params;
  return <JoinOrganization slug={organization} />;
}
