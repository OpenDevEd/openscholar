import { describe, expect, it } from "vitest";
import { opensFurther } from "./report";

describe("a live report's file access", () => {
  it("only ever opens further: private may open, an embargo may open or end sooner, and nothing closes again", () => {
    expect(opensFurther({ mode: "private" }, { mode: "embargo", until: "2027-06-01" })).toBe(true);
    expect(opensFurther({ mode: "private" }, { mode: "readers" })).toBe(true);
    expect(opensFurther({ mode: "embargo", until: "2027-06-01" }, { mode: "embargo", until: "2027-03-01" })).toBe(true);
    expect(opensFurther({ mode: "embargo", until: "2027-06-01" }, { mode: "open" })).toBe(true);
    // A later day keeps it from readers longer, and private keeps it from them for good.
    expect(opensFurther({ mode: "embargo", until: "2027-06-01" }, { mode: "embargo", until: "2027-09-01" })).toBe(false);
    expect(opensFurther({ mode: "embargo", until: "2027-06-01" }, { mode: "private" })).toBe(false);
    expect(opensFurther({ mode: "open" }, { mode: "private" })).toBe(false);
    expect(opensFurther({ mode: "readers" }, { mode: "private" })).toBe(false);
  });
});
