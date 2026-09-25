"use client";

import useSWR from "swr";
import { readTopicNodes } from "@/app/actions/topics";

/** Names for research area ids, looked up on the platform so pages skip the catalog file. */
export function useTopicNames(ids: readonly string[]): Record<string, string> {
  const nodes = [...new Set(ids)].sort();
  const result = useSWR(
    nodes.length ? ["topic-names", ...nodes] : null,
    async () => {
      const batches = await Promise.all(
        Array.from({ length: Math.ceil(nodes.length / 100) }, (_, index) =>
          readTopicNodes(nodes.slice(index * 100, index * 100 + 100)),
        ),
      );
      return Object.fromEntries(batches.flat().map((node) => [node.id, node.name]));
    },
    { revalidateOnFocus: false },
  );
  return result.data ?? {};
}
