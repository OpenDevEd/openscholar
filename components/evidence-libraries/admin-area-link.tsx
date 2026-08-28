import type { ComponentPropsWithoutRef } from "react";

/**
 * A link to a library's admin area.
 *
 * It is always a plain `<a>`, never a client link: asking for that address
 * spends a single-use sign-in code, and Next fetches `<Link>` destinations
 * before the click. Every route in the app that points at
 * `/evidence-libraries/<id>/admin` goes through here.
 */
export function AdminAreaLink({
  libraryId,
  ...rest
}: { libraryId: string } & Omit<ComponentPropsWithoutRef<"a">, "href">) {
  return (
    <a
      href={`/evidence-libraries/${encodeURIComponent(libraryId)}/admin`}
      {...rest}
    />
  );
}
