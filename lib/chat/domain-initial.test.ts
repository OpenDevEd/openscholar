import { describe, expect, it } from "vitest";
import { domainInitial } from "./domain-initial";

describe("domainInitial", () => {
  it("returns the uppercased first letter of a bare host", () => {
    expect(domainInitial("arxiv.org")).toBe("A");
  });

  it("strips a leading www. before taking the first letter", () => {
    expect(domainInitial("www.example.com")).toBe("E");
  });

  it("strips a leading www. case-insensitively", () => {
    expect(domainInitial("WWW.example.com")).toBe("E");
  });

  it("uppercases lowercase first letters", () => {
    expect(domainInitial("nature.com")).toBe("N");
  });

  it("returns ? for an empty host", () => {
    expect(domainInitial("")).toBe("?");
  });

  it("returns ? when only a www. prefix is present", () => {
    expect(domainInitial("www.")).toBe("?");
  });

  it("handles non-letter first characters by returning them as-is", () => {
    expect(domainInitial("123.example.com")).toBe("1");
  });
});
