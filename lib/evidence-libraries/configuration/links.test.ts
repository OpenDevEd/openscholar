import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PAGES,
  collectionHref,
  hrefFor,
  linkPayload,
  readLink,
  targetFor,
} from "./links";

describe("hrefFor and targetFor", () => {
  it("maps every built-in page to its runtime path and back", () => {
    for (const page of BUILT_IN_PAGES) {
      const href = hrefFor({ kind: "page", page: page.key });
      expect(href).toBe(page.path);
      expect(targetFor(href)).toEqual({ kind: "page", page: page.key });
    }
  });

  it("links a collection through the library page's collections filter", () => {
    expect(collectionHref("ABC123")).toBe("/lib?collections=ABC123");
    expect(targetFor("/lib?collections=ABC123")).toEqual({
      kind: "collection",
      collectionId: "ABC123",
    });
  });

  it("keeps an external address as is", () => {
    expect(hrefFor({ kind: "url", url: "https://example.org/about" })).toBe(
      "https://example.org/about",
    );
    expect(targetFor("https://example.org/about")).toEqual({
      kind: "url",
      url: "https://example.org/about",
    });
  });

  it("shows an unknown internal path as an address so the owner can fix it", () => {
    expect(targetFor("/statistics")).toEqual({ kind: "url", url: "/statistics" });
  });
});

describe("readLink and linkPayload", () => {
  it("round-trips a runtime link with children", () => {
    const saved = {
      id: "nav_1",
      label: "Topics",
      href: "/lib",
      icon: "Bookshelf",
      target: "self",
      visible: true,
      children: [
        { id: "nav_1a", label: "AI", href: "/lib?collections=COL1", target: "self", visible: false },
      ],
    };
    const draft = readLink(saved);
    expect(draft).toEqual({
      id: "nav_1",
      label: "Topics",
      target: { kind: "page", page: "library" },
      icon: "Bookshelf",
      newTab: false,
      visible: true,
      children: [
        {
          id: "nav_1a",
          label: "AI",
          target: { kind: "collection", collectionId: "COL1" },
          icon: "",
          newTab: false,
          visible: false,
          children: [],
        },
      ],
    });
    expect(linkPayload(draft, { children: true })).toEqual(saved);
  });

  it("writes a new-tab external link with a blank target and no icon key", () => {
    const draft = readLink({
      id: "nav_2",
      label: "About",
      href: "https://example.org",
      target: "blank",
    });
    expect(draft.newTab).toBe(true);
    expect(linkPayload(draft, { children: false })).toEqual({
      id: "nav_2",
      label: "About",
      href: "https://example.org",
      target: "blank",
      visible: true,
    });
  });

  it("never asks for a new tab on a page link", () => {
    const draft = readLink({ id: "nav_3", label: "Home", href: "/", target: "blank" });
    expect(linkPayload(draft, { children: false }).target).toBe("self");
  });
});
