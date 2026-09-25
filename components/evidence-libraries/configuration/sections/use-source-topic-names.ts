"use client";

import useSWR from "swr";
import { readTopicNodes } from "@/app/actions/topics";

/** Names for catalog ids, looked up on the platform so the page skips the catalog file. */
export function useSourceTopicNames(ids: readonly string[]) {
  const nodes = [...new Set(ids)].sort();
  const result = useSWR(
    nodes.length ? ["source-topic-names", ...nodes] : null,
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
