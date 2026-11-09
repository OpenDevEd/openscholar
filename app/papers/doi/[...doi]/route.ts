import { readPaperPathByDoi } from "@/lib/papers/paper-page-data";

/**
 * A paper's page by its DOI, for lists that know a paper only by its DOI (a topic's community records): the paper's page
 * when our index holds it, otherwise the DOI's own address.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ doi: string[] }> }) {
  const doi = (await params).doi.map(decodeURIComponent).join("/");
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) return new Response("Not found", { status: 404 });
  const path = await readPaperPathByDoi(doi.toLowerCase()).catch((error: unknown) => {
    console.error("[paper page] DOI lookup unavailable", { doi, error });
    return null;
  });
  return path
    ? new Response(null, { status: 308, headers: { Location: path } })
    : new Response(null, { status: 302, headers: { Location: `https://doi.org/${doi}` } });
}
