"use client";

import { ExternalLink } from "lucide-react";

/** The library's public address as a link that opens it in a new tab. Shown under page titles. */
export function LibraryAddressLink({ address }: { address: string }) {
  const host = address.replace(/^https?:\/\//, "");
  return (
    <a
      href={address}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 hover:text-foreground hover:underline"
      data-library-address
    >
      <span className="truncate">{host}</span>
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}
