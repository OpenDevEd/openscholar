import type { Metadata } from "next";
import { PublishFlow } from "@/components/reports/publish-flow";

export const metadata: Metadata = { title: "Publish | Openscholar" };

/**
 * Publish to Openscholar Reports (plans/publish-reports). It is a workspace's section, like the library: under
 * /o/<slug> it shows that organisation's reports, and outside it the person's own. Which report it shows is in the
 * address (`report`), so a link from an email, a reload and the back button all land on the same report.
 */
export default function PublishPage() {
  return <PublishFlow />;
}
