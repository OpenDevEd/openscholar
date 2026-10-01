import type { ComponentPropsWithoutRef } from "react";

/**
 * A link to a library's admin area, opened in a new tab like every other link
 * out to a library, so OpenScholar stays where it was. The library signs the
 * person in with their OpenScholar account itself.
 */
export function AdminAreaLink({
  address,
  path = "/admin",
  ...rest
}: {
  /** Where the library answers, such as `https://climate.opendev.space`. */
  address: string;
  /** Where in the admin to land, such as `/admin?source=<key>`. */
  path?: `/admin${string}`;
} & Omit<ComponentPropsWithoutRef<"a">, "href" | "target" | "rel">) {
  return <a href={new URL(path, address).toString()} target="_blank" rel="noopener noreferrer" {...rest} />;
}
