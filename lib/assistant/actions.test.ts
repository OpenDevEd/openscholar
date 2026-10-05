import { describe, expect, it } from "vitest";
import { USER_ACTIONS } from "../../convex/lib/userActionRegistry";
import { WORDED, viewOf } from "./actions";

describe("the words for what the assistant did", () => {
  it("are there for every action it can run, and for none it can't", () => {
    const registered = new Set(USER_ACTIONS.map((action) => action.path));
    // One with no words shows as "Worked in your account", which tells the person nothing.
    expect([...registered].filter((path) => viewOf(path).words === "other")).toEqual([]);
    expect([...WORDED].filter((path) => !registered.has(path.split("#")[0]!))).toEqual([]);
  });

  it("are those of the job done, for the action that changes research records in several ways", () => {
    expect(viewOf("research/records:change", "rating")).toMatchObject({ kind: "paper", words: "rate" });
    expect(viewOf("research/records:change", "createSearch").words).toBe("newSearch");
    // A kind it doesn't know reads as a change to a search, not as nothing.
    expect(viewOf("research/records:change", "somethingNew").words).toBe("changeSearch");
  });
});
