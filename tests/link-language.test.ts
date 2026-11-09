// A community site's link names its reader's language (OS-31): it's used only by someone with none here yet.
import { describe, expect, it } from "vitest";
import { languageFromLink } from "../i18n/link-language";

const link = new URL("https://dev.openscholar.ai/evidence-communities?apply=abc&hl=fr");

describe("the language a community site's link names", () => {
  it("starts someone with no language here in it, and leaves the address without it", () => {
    const found = languageFromLink(link, false);
    expect(found?.locale).toBe("fr");
    expect(found?.clean.toString()).toBe("https://dev.openscholar.ai/evidence-communities?apply=abc");
  });

  it("leaves a language the person has here as it is, and one we don't have unused", () => {
    expect(languageFromLink(link, true)?.locale).toBeNull();
    expect(languageFromLink(new URL("https://dev.openscholar.ai/evidence-communities?hl=xx"), false)?.locale).toBeNull();
  });

  it("does nothing to an address that names no language", () => {
    expect(languageFromLink(new URL("https://dev.openscholar.ai/evidence-communities?apply=abc"), false)).toBeNull();
  });
});
