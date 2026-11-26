import { redirect } from "next/navigation";
import { ScreeningsIndex } from "@/components/screening/index-page";
import { newHref } from "@/components/screening/links";
import { screeningPath } from "@/lib/screening/links";

// The workspace's screenings, the ones waiting on the person first. An address from before each screening had its
// own page still opens what it named: a screening, the form on a search, or the form on what a community handed over.
export default async function ScreeningsPage({ params, searchParams }: { params: Promise<{ slug?: string }>; searchParams: Promise<{ job?: string; search?: string; handoff?: string }> }) {
  const [{ slug }, { job, search, handoff }] = await Promise.all([params, searchParams]);
  // An organization's pages sit under its own address.
  const within = (path: string) => `${slug ? `/o/${encodeURIComponent(slug)}` : ""}${path}`;
  if (job === "new" || (!job && (search || handoff))) redirect(within(newHref(search ? { search } : { handoff })));
  if (job) redirect(within(screeningPath(encodeURIComponent(job))));
  return <ScreeningsIndex />;
}
