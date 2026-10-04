import { redirect } from "next/navigation";

/**
 * A library's own address in OpenScholar, which the library links back to,
 * opens its configuration.
 */
export default async function EvidenceLibraryPage({
  params,
}: {
  params: Promise<{ libraryId: string }>;
}) {
  const { libraryId } = await params;
  redirect(`/evidence-libraries/${encodeURIComponent(libraryId)}/configuration`);
}
