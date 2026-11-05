import { describe, expect, it } from "vitest";
import { withoutDetails } from "./report-server-error";

const failure = () => {
  const error = Object.assign(new TypeError("no results for someone@example.com\nand what they typed"), { digest: "123456" });
  error.stack = `TypeError: no results for someone@example.com\nand what they typed\n    at render (/app/.next/server/chunks/1.js:2:3)\n    at run (/app/.next/server/chunks/2.js:4:5)`;
  return error;
};

describe("withoutDetails", () => {
  it("drops the message, which can hold what someone typed, everywhere it appears", () => {
    const report = withoutDetails(failure());
    expect(report.message).not.toContain("someone@example.com");
    expect(report.stack).not.toContain("someone@example.com");
    expect(report.stack).not.toContain("what they typed");
  });

  it("doesn't mistake a line of the message for a frame", () => {
    const error = new Error("failure\n    at someone@example.com");
    error.stack = `Error: failure\n    at someone@example.com\n    at render (/app/.next/server/chunks/1.js:2:3)`;
    const report = withoutDetails(error);
    expect(report.stack).not.toContain("someone@example.com");
    expect(report.stack).toContain("/app/.next/server/chunks/1.js:2:3");
  });

  it("sends no frames from a stack that doesn't start with its message", () => {
    const error = new Error("someone@example.com");
    error.stack = "    at someone@elsewhere.example\n    at render (/app/.next/server/chunks/1.js:2:3)";
    expect(withoutDetails(error).stack).not.toContain("example");
  });

  it("keeps the type, the frames and the digest that finds the whole error in the server's log", () => {
    const report = withoutDetails(failure());
    expect(report.name).toBe("TypeError");
    expect(report.stack).toContain("/app/.next/server/chunks/1.js:2:3");
    expect(report.stack).toContain("/app/.next/server/chunks/2.js:4:5");
    expect(report.message).toContain("123456");
  });

  it("reports a thrown value that isn't an Error without repeating it", () => {
    const report = withoutDetails("someone@example.com");
    expect(report.name).toBe("Error");
    expect(`${report.message}${report.stack}`).not.toContain("someone@example.com");
  });
});
