"use client";

import useSWR from "swr";
import { readFunderNames } from "@/app/actions/funders";

/** Names for funder ids such as F4320311904. */
export function useFunderNames(ids: readonly string[]): Record<string, string> {
  const sorted = [...new Set(ids)].sort();
  const result = useSWR(sorted.length ? ["funder-names", ...sorted] : null, () => readFunderNames(sorted), {
    revalidateOnFocus: false,
  });
  return result.data ?? {};
}
