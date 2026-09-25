import { describe, expect, it } from "vitest";
import { publicName, publicPhoto, squareCrop } from "./home-people";

describe("home page people", () => {
  it("names a person on one line, within the runtime's 120 characters, and never by an empty name", () => {
    expect(publicName("  Ada\nLovelace  ")).toBe("Ada Lovelace");
    expect(publicName("A".repeat(200))).toHaveLength(120);
    expect(publicName("   ")).toBeUndefined();
    expect(publicName(undefined)).toBeUndefined();
    expect(publicName("Ada\u0000Lovelace\u0007")).toBe("AdaLovelace");
  });

  it("keeps only photo addresses the runtime accepts", () => {
    expect(publicPhoto("https://img.example.test/ada.png?size=240")).toBe("https://img.example.test/ada.png?size=240");
    expect(publicPhoto("http://img.example.test/ada.png")).toBeUndefined();
    expect(publicPhoto("https://img.example.test/ada.png#photo")).toBeUndefined();
    expect(publicPhoto("https://user:secret@img.example.test/ada.png")).toBeUndefined();
    expect(publicPhoto("https://img.example.test/<ada>.png")).toBeUndefined();
    expect(publicPhoto("not a url")).toBeUndefined();
    expect(publicPhoto(" https://img.example.test/a b/é.png ")).toBe("https://img.example.test/a%20b/%C3%A9.png");
  });

  it("reads photos where URL.canParse does not exist, as in Convex queries", () => {
    const canParse = URL.canParse;
    // @ts-expect-error Convex's query runtime has no URL.canParse.
    delete URL.canParse;
    try {
      expect(publicPhoto("https://img.example.test/ada.png")).toBe("https://img.example.test/ada.png");
      expect(publicPhoto("not a url")).toBeUndefined();
    } finally {
      URL.canParse = canParse;
    }
  });
});

describe("photo crop", () => {
  it("keeps the upper part of a portrait, where the face is", () => {
    expect(squareCrop(800, 1200)).toEqual({ side: 800, x: 0, y: 80 });
  });

  it("keeps the middle of a landscape and all of a square", () => {
    expect(squareCrop(1200, 800)).toEqual({ side: 800, x: 200, y: 0 });
    expect(squareCrop(500, 500)).toEqual({ side: 500, x: 0, y: 0 });
  });
});
