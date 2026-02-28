import { describe, expect, it } from "vitest";
import { jsonToCSV } from "../lib/utils";

describe("jsonToCSV", () => {
  it("returns empty string for empty array", () => {
    expect(jsonToCSV([])).toBe("");
  });

  it("produces correct sorted headers and values for single object", () => {
    const csv = jsonToCSV([{ name: "Alice", age: 30 }]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("age,name");
    expect(lines[1]).toBe("30,Alice");
  });

  it("produces union of keys as headers for objects with different keys", () => {
    const csv = jsonToCSV([
      { name: "Alice", age: 30 },
      { name: "Bob", city: "NYC" },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("age,city,name");
    expect(lines[1]).toBe("30,,Alice");
    expect(lines[2]).toBe(",NYC,Bob");
  });

  it("wraps single non-array object in array", () => {
    const csv = jsonToCSV({ name: "Alice" });
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("name");
    expect(lines[1]).toBe("Alice");
  });

  it("escapes values containing commas", () => {
    const csv = jsonToCSV([{ name: "Smith, John" }]);
    expect(csv).toContain('"Smith, John"');
  });

  it("escapes values containing double quotes by doubling them", () => {
    const csv = jsonToCSV([{ title: 'Say "hello"' }]);
    expect(csv).toContain('"Say ""hello"""');
  });

  it("escapes values containing newlines", () => {
    const csv = jsonToCSV([{ bio: "Line 1\nLine 2" }]);
    expect(csv).toContain('"Line 1\nLine 2"');
  });

  it("escapes values containing carriage returns", () => {
    const csv = jsonToCSV([{ bio: "Line 1\rLine 2" }]);
    expect(csv).toContain('"Line 1\rLine 2"');
  });

  it("produces empty string for null and undefined values", () => {
    const csv = jsonToCSV([{ a: null, b: undefined, c: "ok" }]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe(",,ok");
  });

  it("quotes empty string values", () => {
    const csv = jsonToCSV([{ name: "" }]);
    expect(csv.split("\n")[1]).toBe('""');
  });

  it("JSON-stringifies object values and escapes the result", () => {
    const csv = jsonToCSV([{ data: { nested: true } }]);
    // JSON.stringify({nested:true}) => '{"nested":true}' contains quotes
    // escapeCSVValue doubles the quotes and wraps: "{""nested"":true}"
    expect(csv.split("\n")[1]).toBe('"{""nested"":true}"');
  });

  it("does not quote plain number values", () => {
    const csv = jsonToCSV([{ count: 42 }]);
    expect(csv.split("\n")[1]).toBe("42");
  });

  it("does not quote plain boolean values", () => {
    const csv = jsonToCSV([{ active: true }]);
    expect(csv.split("\n")[1]).toBe("true");
  });

  it("escapes header names containing special characters", () => {
    const csv = jsonToCSV([{ "Question, Answer": "yes" }]);
    expect(csv.split("\n")[0]).toContain('"Question, Answer"');
  });
});
