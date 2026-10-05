import { test, describe } from "vitest";
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

  test("zero changes stay stable", async ({ bench }) => {
    await bench("stabilize rows", () => stabilizeRowsById(prev, nextSame)).run();
  });

  test("one row changed", async ({ bench }) => {
    await bench("stabilize rows", () => stabilizeRowsById(prev, nextOneChanged)).run();
  });
});

describe("runWeightedSearch @ N=1000", () => {
  const rows = makeFakeRows(1000);

  test("short query (3 chars)", async ({ bench }) => {
    await bench("search", () => runWeightedSearch(rows, "pho")).run();
  });

  test("long query (12 chars)", async ({ bench }) => {
    await bench("search", () => runWeightedSearch(rows, "photosynthes")).run();
  });

  test("no match", async ({ bench }) => {
    await bench("search", () => runWeightedSearch(rows, "zzzzzz")).run();
  });
});

describe("sortByComparator @ N=1000", () => {
  const rows = makeFakeRows(1000);

  test("added asc", async ({ bench }) => {
    await bench("sort", () => sortByComparator(rows, "added", "asc")).run();
  });

  test("title asc", async ({ bench }) => {
    await bench("sort", () => sortByComparator(rows, "title", "asc")).run();
  });

  test("inContext desc", async ({ bench }) => {
    await bench("sort", () => sortByComparator(rows, "inContext", "desc")).run();
  });
});
