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

it("seeds the catalog in chunks and filters exact ancestors with cursor paging", async () => {
  const t = convexTest(schema, modules);
  await t.action(api.topics.catalog.initialize, {});
  const domains = await t.query(api.topics.catalog.directory, {parent: null, cursor: null, limit: 100});
  expect(domains.nodes).toHaveLength(4);
  const first = await t.query(api.topics.catalog.directory, {ancestor: "subfields/1702", cursor: null, limit: 2});
  const second = await t.query(api.topics.catalog.directory, {ancestor: "subfields/1702", cursor: first.nextCursor, limit: 2});
  expect(first.nodes).toHaveLength(2);
  expect(second.nodes).toHaveLength(2);
  expect(first.nodes.every(node => node.parent === "subfields/1702")).toBe(true);
  expect(new Set([...first.nodes, ...second.nodes].map(node => node.id)).size).toBe(4);
  expect((await t.query(api.topics.catalog.resolve, {ids: ["T12260"]}))[0]).toMatchObject({id: "T12260", level: "topic"});
});
