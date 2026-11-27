// Whether a screening's papers can split decides whether it offers a settler and says conflicts can happen: a page that says they can't, while a kept vote makes one, leaves a conflict nobody was told to expect.
import { describe, expect, it, vi } from "vitest";
// The data module reaches the app's Convex client as it loads; an address is all it needs here, nothing is fetched.
vi.hoisted(() => { process.env.NEXT_PUBLIC_CONVEX_URL ??= "https://example.convex.cloud"; });
import { splitsIn, type Screening } from "../components/screening/data";

const person = (id: string, left?: { cast: number }) => ({ id, kind: "person" as const, name: id, addedAt: 0, ...(left ? { left: 1, tally: { cast: left.cast } } : {}) });
const screening = (each: "1" | "2" | "all", reviewers: ReturnType<typeof person>[]) => ({ rule: { each, settle: "all", models: "vote", resolver: "a", blind: "after" }, reviewers }) as unknown as Pick<Screening, "rule" | "reviewers">;

describe("splitsIn", () => {
  it("counts a vote kept from someone taken off beside the places still open", () => {
    // Two readers a paper: Bob voted and was taken off with his votes kept, and Alice still votes on his papers.
    expect(splitsIn(screening("2", [person("alice"), person("bob", { cast: 3 })]), 0)).toBe(true);
    // Nobody taken off has a vote kept: Alice alone settles each paper.
    expect(splitsIn(screening("2", [person("alice"), person("bob", { cast: 0 })]), 0)).toBe(false);
  });
});
