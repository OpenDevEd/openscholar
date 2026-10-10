import { OpenShared } from "@/components/workspaces/shared";

// Where an invitation to an item links (#653): the invited person, signed in, opens it here.
export default async function SharedInvitationPage({ params }: { params: Promise<{ invitation: string }> }) {
  const { invitation } = await params;
  return <OpenShared invitationId={invitation} />;
}
