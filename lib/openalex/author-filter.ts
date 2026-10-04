/** Whether an author in the filter is an OpenAlex author id, such as A5023888391, and not a name. */
export const isAuthorId = (value: string) => /^A\d+$/.test(value);

/**
 * An author as the search keeps it. One OpenAlex has a record for is its bare
 * id, such as A5023888391; a pasted OpenAlex address is cut down to it, so the
 * same author is never in the filter twice under two spellings. One it has no
 * record for (often an organisation typed in as an author) is the name as the
 * work gives it, without the characters that separate values in the address
 * and in OpenAlex's filter.
 */
export function authorFilterValue(value: string): string | null {
  const id = value.trim().match(/^(?:https?:\/\/openalex\.org\/(?:authors\/)?)?(a\d+)$/i)?.[1];
  if (id) return id.toUpperCase();
  return value.replace(/[",|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200).trim() || null;
}
