/**
 * A Creative Commons licence code as OpenAlex and reports write it (cc-by, cc-by-nc-nd, cc-by-4.0): its name as people
 * write it, and the address of its deed when the code names the version. Null for any other code (other-oa,
 * implied-oa), which the open access chip already says.
 */
export function creativeCommons(code: string | null | undefined): { name: string; url: string | null } | null {
  const match = /^cc-((?:by|nc|nd|sa)(?:-(?:nc|nd|sa))*)(?:-(\d\.\d))?$/i.exec(code?.trim() ?? "");
  if (!match) return null;
  const terms = match[1]!.toLowerCase();
  const version = match[2];
  return { name: `CC ${terms.toUpperCase()}${version ? ` ${version}` : ""}`, url: version ? `https://creativecommons.org/licenses/${terms}/${version}/` : null };
}
