"use client";

import useSWR from "swr";
import { readTopicNodes } from "@/app/actions/topics";
import type { OpenAlexTopicLevel } from "@/lib/evidence-libraries/openalex-source-query";

export function useSourceTopicNames(
  level: OpenAlexTopicLevel,
  ids: readonly string[],
) {
  const nodes = [...new Set(ids)]
    .sort()
    .map((id) => (level === "topic" ? id : `${level}s/${id}`));
  const result = useSWR(
    nodes.length ? ["source-topic-names", ...nodes] : null,
    async () => {
      const batches = await Promise.all(
        Array.from({ length: Math.ceil(nodes.length / 100) }, (_, index) =>
          readTopicNodes(nodes.slice(index * 100, index * 100 + 100)),
        ),
      );
      return Object.fromEntries(
        batches.flat().map((node) => [node.id.split("/").at(-1)!, node.name]),
      );
    },
    { revalidateOnFocus: false },
  );
  return result.data ?? {};
}
