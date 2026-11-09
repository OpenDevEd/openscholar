import { AdminPublishing } from "@/components/publish-mock/admin-publishing";
import { notFound } from "next/navigation";
import { accountOf, accountsMatching, isAdmin } from "@/lib/publish-mock/admin";
import { readState } from "@/lib/publish-mock/store";

// MOCK (mock/publish-reports): read from the mock's local store, so the page is whole from its first frame.
export default async function AdminPublishingPage() {
  // The admin layout decides in the browser; the data itself goes only to an admin.
  if (!(await isAdmin())) notFound();
  const state = await readState();
  // Who each limit is for, as Clerk has them now, and the accounts an admin can pick from: both there from the first frame.
  const [accounts, described] = await Promise.all([
    accountsMatching("").catch(() => ({ people: [], organizations: [] })),
    Promise.all(state.settings.limits.overrides.map(async (o) => ({ ...o, ...((await accountOf(o.kind, o.id)) ?? {}) }))),
  ]);
  state.settings.limits.overrides = described;
  return <AdminPublishing initial={state} accounts={accounts} />;
}
