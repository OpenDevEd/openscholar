/// <reference types="vite/client" />
import {convexTest} from "convex-test";
import {expect, it, vi} from "vitest";
import schema from "../schema";
import {api} from "../_generated/api";

// Seeding all ~4,800 real nodes takes 30s in CI. The domains plus the Computer
// Science field keep real parents and still span several 100-node seed chunks.
vi.mock("../../lib/topics/openalex-topics.json", async importOriginal => {
  const tree = (await importOriginal<{default: {id: string; name: string; parent: string | null}[]}>()).default;
  const byId = new Map(tree.map(node => [node.id, node]));
  const inComputerScience = (id: string | null): boolean => id === "fields/17" || (!!id && inComputerScience(byId.get(id)?.parent ?? null));
  return {default: tree.filter(node => node.id.startsWith("domains/") || inComputerScience(node.id))};
});
const modules = import.meta.glob("/convex/**/*.ts");

it("seeds every node across its 100-node chunks, with levels and ancestors", async () => {
  const t = convexTest(schema, modules);
  await t.action(api.topics.catalog.initialize, {});
  const rows = await t.run(ctx => ctx.db.query("topicCatalog").collect());
  const {default: tree} = await import("../../lib/topics/openalex-topics.json");
  expect(rows).toHaveLength(tree.length);
  expect(tree.length).toBeGreaterThan(200);
  expect(rows.filter(row => row.level === "domain")).toHaveLength(4);
  expect(rows.find(row => row.id === "T12260")).toMatchObject({level: "topic", ancestors: ["domains/3", "fields/17", "subfields/1702"]});
});
