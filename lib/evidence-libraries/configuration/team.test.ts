import { describe, expect, it } from "vitest";
import { initialsOf } from "./team";

describe("initialsOf", () => {
  it("uses the first and last name, then the name, then the email", () => {
    expect(initialsOf("Ada Lovelace", "ada@example.org")).toBe("AL");
    expect(initialsOf("Ada Byron Lovelace", "")).toBe("AL");
    expect(initialsOf("Grace", "")).toBe("GR");
    expect(initialsOf("  ", "grace@example.org")).toBe("GR");
    expect(initialsOf("", "")).toBe("?");
  });
});
