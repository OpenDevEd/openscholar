import { describe, expect, it } from "vitest";
import { normalizeOpenAlexId } from "../lib/openalex/normalize";

describe("normalizeOpenAlexId", () => {
  it("returns bare ID unchanged", () => {
    expect(normalizeOpenAlexId("W123456789")).toBe("W123456789");
  });

  it("uppercases lowercase bare ID", () => {
    expect(normalizeOpenAlexId("w123456789")).toBe("W123456789");
  });

  it("extracts ID from full https URL", () => {
    expect(normalizeOpenAlexId("https://openalex.org/W123456789")).toBe(
      "W123456789",
    );
  });

  it("extracts ID from http URL", () => {
    expect(normalizeOpenAlexId("http://openalex.org/W123456789")).toBe(
      "W123456789",
    );
  });

  it("extracts ID from URL with query params", () => {
    expect(normalizeOpenAlexId("https://openalex.org/W123?source=api")).toBe(
      "W123",
    );
  });

  it("extracts ID from URL with fragment", () => {
    expect(normalizeOpenAlexId("https://openalex.org/W123#section")).toBe(
      "W123",
    );
  });

  it("extracts ID from openalex: prefixed format", () => {
    expect(normalizeOpenAlexId("openalex:W123456789")).toBe("W123456789");
  });

  it("uppercases openalex: prefixed lowercase ID", () => {
    expect(normalizeOpenAlexId("openalex:w123")).toBe("W123");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeOpenAlexId("  W123  ")).toBe("W123");
  });

  it("returns null for empty string", () => {
    expect(normalizeOpenAlexId("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeOpenAlexId("   ")).toBeNull();
  });

  it("returns null for DOI", () => {
    expect(normalizeOpenAlexId("10.1234/test")).toBeNull();
  });

  it("returns null for PubMed ID", () => {
    expect(normalizeOpenAlexId("PMID:12345")).toBeNull();
  });

  it("returns null for non-work OpenAlex entity", () => {
    expect(normalizeOpenAlexId("S123456789")).toBeNull();
  });

  it("returns null for DOI URL", () => {
    expect(normalizeOpenAlexId("https://doi.org/10.1234/test")).toBeNull();
  });
});
