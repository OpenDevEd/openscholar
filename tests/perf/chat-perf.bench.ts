import { bench, describe } from "vitest";
import { stabilizeRowsById } from "@/lib/chat/stabilize-rows";
import { runWeightedSearch } from "@/lib/chat/search/source-scorer";
import { sortByComparator } from "@/lib/chat/sort/source-comparators";
import { makeFakeRows } from "./fixtures/fake-rows";

describe("stabilizeRowsById @ N=1000", () => {
  const prev = makeFakeRows(1000);
  const nextSame = prev.slice();
  const nextOneChanged = prev.map((r, i) =>
    i === 500 ? { ...r, included: !r.included } : r,
  );

  bench("zero changes — fully stable", () => {
    stabilizeRowsById(prev, nextSame);
  });

  bench("one row changed", () => {
    stabilizeRowsById(prev, nextOneChanged);
  });
});

describe("runWeightedSearch @ N=1000", () => {
  const rows = makeFakeRows(1000);

  bench("short query (3 chars)", () => {
    runWeightedSearch(rows, "pho");
  });

  bench("long query (12 chars)", () => {
    runWeightedSearch(rows, "photosynthes");
  });

  bench("no match", () => {
    runWeightedSearch(rows, "zzzzzz");
  });
});

describe("sortByComparator @ N=1000", () => {
  const rows = makeFakeRows(1000);

  bench("added asc", () => {
    sortByComparator(rows, "added", "asc");
  });

  bench("title asc", () => {
    sortByComparator(rows, "title", "asc");
  });

  bench("inContext desc", () => {
    sortByComparator(rows, "inContext", "desc");
  });
});
