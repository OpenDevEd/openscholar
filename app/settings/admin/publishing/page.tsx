import { notFound } from "next/navigation";
import { AdminPublishing } from "@/components/publish-mock/admin-publishing";
import { accountOf, accountsMatching, isAdmin } from "@/lib/publish-mock/admin";
import { readState } from "@/lib/publish-mock/store";

// MOCK (mock/publish-reports): read from the mock's local store, so the page is whole from its first frame.
export default async function AdminPublishingPage() {
  // The admin layout decides in the browser; the data itself goes only to an admin.
  if (!(await isAdmin())) notFound();
  const state = await readState();
  // The accounts an admin can pick from, and who each limit is for as Clerk has them now: both there from the first frame.
  const [accounts, known] = await Promise.all([
    accountsMatching("").catch(() => ({ people: [], organizations: [] })),
    Promise.all(state.settings.limits.overrides.map((o) => accountOf(o.kind, o.id))),
  ]);
  return <AdminPublishing initial={state} accounts={accounts} known={known.filter((account) => account !== null)} />;
}
