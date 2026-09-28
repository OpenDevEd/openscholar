import type { ComponentPropsWithoutRef } from "react";

import { buildAdminRouteHref } from "@/lib/evidence-libraries/admin-handoff";

/**
 * A link to a library's admin area, opened in a new tab like every other link
 * out to a library, so OpenScholar stays where it was.
 *
 * It is always a plain `<a>`, never a client link: asking for that address
 * spends a single-use sign-in code, and Next fetches `<Link>` destinations
 * before the click. Every link in the app that points at
 * `/evidence-libraries/<id>/admin` uses this component, except the status
 * page's panels: that page already sits in the tab this link opened, so they
 * render theirs through `AuthStatePanel` with `primaryNavigation="document"`.
 */
export function AdminAreaLink({
  libraryId,
  returnPath,
  ...rest
}: {
  libraryId: string;
  /** Where in the admin to land, such as `/admin?source=<key>`. */
  returnPath?: string;
} & Omit<ComponentPropsWithoutRef<"a">, "href" | "target" | "rel">) {
  return (
    <a
      href={buildAdminRouteHref({ libraryId, returnPath })}
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
    />
  );
}
