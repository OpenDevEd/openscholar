import { describe, expect, it } from "vitest";
import {
  changedSectionRows,
  isDirty,
  hasProblems,
  readDraft,
  resetSection,
  sectionProblems,
  sectionState,
  SCHEMA_LIMITS,
  THEME_DEFAULTS,
  type ConfigurationDraft,
} from "./rules";

const savedRows = [
  {
    sectionKey: "identity",
    payload: {
      name: "Saved Library",
      shortName: "saved-library",
      baseUrl: "https://saved-library.libraries.example.test",
      tagline: "Evidence for better decisions",
      fundingPartners: [{ id: "fp_1", name: "Jacobs Foundation" }],
      assets: {
        logoDark: "https://assets.example.test/logo-dark.svg",
        favicon: "https://assets.example.test/favicon.svg",
      },
    },
  },
  {
    sectionKey: "theme",
    payload: {
      layout: "wide",
      colors: { accent: "#e68124", tertiary: "#2b4c7e" },
    },
  },
  {
    sectionKey: "institutions",
    payload: [{ id: "inst_1", name: "EdTech Hub" }],
  },
  {
    sectionKey: "localization",
    payload: { locales: ["en-GB"], defaultLocale: "en-GB" },
  },
] as const;

function savedDraft() {
  return readDraft(savedRows);
}

describe("readDraft", () => {
  it("fills missing optional values so every control has a value", () => {
    const draft = savedDraft();
    expect(draft.identity.description).toBe("");
    expect(draft.identity.assets.logoLight).toBe("");
    expect(draft.identity.assets.shareImage).toBe("");
    expect(draft.theme.layout).toBe("wide");
    expect(draft.theme.defaultMode).toBe(THEME_DEFAULTS.defaultMode);
    expect(draft.theme.colors.link).toBe(THEME_DEFAULTS.colors.link);
    expect(draft.theme.fonts.heading).toBe(THEME_DEFAULTS.fonts.heading);
    expect(draft.institutions[0]).toEqual({
      id: "inst_1",
      name: "EdTech Hub",
      logoUrl: "",
    });
  });

  it("starts a new library with empty assets and default theme", () => {
    const draft = readDraft([
      {
        sectionKey: "identity",
        payload: {
          name: "New",
          shortName: "new",
          baseUrl: "https://new.libraries.example.test",
        },
      },
    ]);
    expect(draft.identity.assets).toEqual({
      logoDark: "",
      logoLight: "",
      favicon: "",
      shareImage: "",
    });
    expect(draft.theme.colors.accent).toBe(THEME_DEFAULTS.colors.accent);
    expect(draft.institutions).toEqual([]);
  });

  it("reads limits from the pinned schema", () => {
    expect(SCHEMA_LIMITS.identity.name).toBe(100);
    expect(SCHEMA_LIMITS.identity.tagline).toBe(160);
    expect(SCHEMA_LIMITS.identity.fundingPartners).toBe(20);
    expect(SCHEMA_LIMITS.institutions.items).toBe(200);
  });
});

describe("sectionProblems", () => {
  it("is empty for a complete draft", () => {
    const draft = savedDraft();
    expect(sectionProblems(draft, "identity")).toEqual([]);
    expect(sectionProblems(draft, "theme")).toEqual([]);
    expect(sectionProblems(draft, "institutions")).toEqual([]);
  });

  it("flags a missing name and an unnamed funding partner", () => {
    const draft = savedDraft();
    draft.identity.name = "  ";
    draft.identity.fundingPartners.push({ id: "fp_2", name: "" });
    expect(sectionProblems(draft, "identity")).toEqual([
      "nameMissing",
      "partnerName",
    ]);
  });

  it("flags missing logos and bad colours on the theme section", () => {
    const draft = savedDraft();
    draft.identity.assets.logoDark = "";
    draft.identity.assets.favicon = "";
    draft.theme.colors.accent = "orange";
    expect(sectionProblems(draft, "theme")).toEqual([
      "logoMissing",
      "faviconMissing",
      "badColour",
    ]);
  });

  it("accepts eight-digit colours like the runtime does", () => {
    const draft = savedDraft();
    draft.theme.colors.accent = "#E68124CC";
    expect(sectionProblems(draft, "theme")).toEqual([]);
  });

  it("flags an institution without a name", () => {
    const draft = savedDraft();
    draft.institutions.push({ id: "inst_2", name: "", logoUrl: "" });
    expect(sectionProblems(draft, "institutions")).toEqual(["institutionName"]);
  });
});

describe("changedSectionRows", () => {
  it("returns nothing when the draft matches the saved rows", () => {
    expect(changedSectionRows(savedDraft(), savedRows)).toEqual([]);
    expect(isDirty(savedDraft(), savedRows)).toBe(false);
  });

  it("sends only the section that changed, without empty optional values", () => {
    const draft = savedDraft();
    draft.identity.name = "Renamed";
    draft.identity.description = "";
    expect(changedSectionRows(draft, savedRows)).toEqual([
      {
        sectionKey: "identity",
        payload: {
          name: "Renamed",
          shortName: "saved-library",
          baseUrl: "https://saved-library.libraries.example.test",
          tagline: "Evidence for better decisions",
          fundingPartners: [{ id: "fp_1", name: "Jacobs Foundation" }],
          assets: {
            logoDark: "https://assets.example.test/logo-dark.svg",
            favicon: "https://assets.example.test/favicon.svg",
          },
        },
      },
    ]);
  });

  it("writes the navigation bar choice to theme.layout", () => {
    const draft = savedDraft();
    draft.theme.layout = "small";
    const rows = changedSectionRows(draft, savedRows);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sectionKey).toBe("theme");
    expect(rows[0]?.payload).toMatchObject({
      layout: "small",
      defaultMode: THEME_DEFAULTS.defaultMode,
      colors: { accent: "#e68124", tertiary: "#2b4c7e" },
      fonts: {
        heading: { source: "google", family: THEME_DEFAULTS.fonts.heading },
        body: { source: "google", family: THEME_DEFAULTS.fonts.body },
      },
    });
  });

  it("treats a section without a saved row as changed", () => {
    const rows = savedRows.filter((row) => row.sectionKey !== "theme");
    const draft = readDraft(rows);
    expect(changedSectionRows(draft, rows).map((row) => row.sectionKey)).toEqual(
      ["theme"],
    );
  });

  it("drops the logo url from an institution when it is empty", () => {
    const draft = savedDraft();
    draft.institutions.push({ id: "inst_2", name: "OpenDevEd", logoUrl: "" });
    expect(changedSectionRows(draft, savedRows)).toEqual([
      {
        sectionKey: "institutions",
        payload: [
          { id: "inst_1", name: "EdTech Hub" },
          { id: "inst_2", name: "OpenDevEd" },
        ],
      },
    ]);
  });
});

describe("sectionState and reset", () => {
  it("shows the logo upload under theme even though it lives in identity", () => {
    const draft = savedDraft();
    draft.identity.assets.logoLight = "https://assets.example.test/logo-light.svg";
    expect(sectionState(draft, savedRows, "theme")).toBe("edited");
    expect(sectionState(draft, savedRows, "identity")).toBe("complete");
  });

  it("puts attention before edited", () => {
    const draft = savedDraft();
    draft.identity.name = "";
    expect(sectionState(draft, savedRows, "identity")).toBe("attention");
    expect(hasProblems(draft)).toBe(true);
  });

  it("restores one section from the saved rows and leaves the rest", () => {
    const draft: ConfigurationDraft = savedDraft();
    draft.identity.name = "Renamed";
    draft.identity.assets.logoDark = "";
    draft.theme.colors.accent = "#000000";
    const reset = resetSection(draft, savedRows, "theme");
    expect(reset.identity.name).toBe("Renamed");
    expect(reset.identity.assets.logoDark).toBe(
      "https://assets.example.test/logo-dark.svg",
    );
    expect(reset.theme.colors.accent).toBe("#e68124");
    expect(sectionState(reset, savedRows, "theme")).toBe("complete");
    expect(sectionState(reset, savedRows, "identity")).toBe("edited");
  });
});
