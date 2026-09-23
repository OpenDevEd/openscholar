import { describe, expect, it } from "vitest";
import { publicName, publicPhoto } from "./home-people";

describe("home page people", () => {
  it("names a person on one line, within the runtime's 120 characters, and never by an empty name", () => {
    expect(publicName("  Ada\nLovelace  ")).toBe("Ada Lovelace");
    expect(publicName("A".repeat(200))).toHaveLength(120);
    expect(publicName("   ")).toBeUndefined();
    expect(publicName(undefined)).toBeUndefined();
  });

  it("keeps only photo addresses the runtime accepts", () => {
    expect(publicPhoto("https://img.example.test/ada.png?size=240")).toBe("https://img.example.test/ada.png?size=240");
    expect(publicPhoto("http://img.example.test/ada.png")).toBeUndefined();
    expect(publicPhoto("https://img.example.test/ada.png#photo")).toBeUndefined();
    expect(publicPhoto("https://user:secret@img.example.test/ada.png")).toBeUndefined();
    expect(publicPhoto("https://img.example.test/<ada>.png")).toBeUndefined();
    expect(publicPhoto("not a url")).toBeUndefined();
  });
});
