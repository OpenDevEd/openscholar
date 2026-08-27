import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";

describe("initialsOf", () => {
  it("uses the first two words, then the email, then nothing", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("Ada Byron Lovelace", "ada@example.org")).toBe("AB");
    expect(initialsOf("Grace")).toBe("G");
    expect(initialsOf("  ", "grace@example.org")).toBe("GR");
    expect(initialsOf("", "")).toBe("");
  });
});
