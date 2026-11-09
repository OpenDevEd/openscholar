import { AdminPublishing } from "@/components/publish-mock/admin-publishing";
import { readState } from "@/lib/publish-mock/store";

// MOCK (mock/publish-reports): read from the mock's local store, so the page is whole from its first frame.
export default async function AdminPublishingPage() {
  return <AdminPublishing initial={await readState()} />;
}
