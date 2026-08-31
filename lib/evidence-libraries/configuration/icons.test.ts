import catalog from "../../../public/library-icons/catalog.json";
import { describe, expect, test } from "vitest";
import { hugeiconShard, iconDisplayName, isNavbarIconId } from "./icons";

describe("Hugeicons catalog", () => {
  test("maps every synced icon to its published sprite shard", () => {
    const entries = Object.entries(catalog);
    expect(entries).toHaveLength(6_025);
    for (const [iconId, shard] of entries) {
      expect(isNavbarIconId(iconId)).toBe(true);
      expect(hugeiconShard(iconId)).toBe(shard);
    }
  });

  test("turns catalog ids into readable picker labels", () => {
    expect(iconDisplayName("ArrowUpDownIcon")).toBe("Arrow Up Down");
    expect(iconDisplayName("AiChat01Icon")).toBe("Ai Chat 01");
  });
});
