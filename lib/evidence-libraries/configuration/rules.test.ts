import { describe, expect, it } from "vitest";
import { TEST_AI_MODELS } from "./test-models";
import {
  AI_PROVIDER,
  cardForRow,
  carryUnsaved,
  collectionOptions,
  featureBlock,
  settleFeatures,
  SEARCH_SCOPES,
  changedSectionRows,
  isDirty,
  hasProblems,
  readDraft,
  resetSection,
  sectionChanged,
  sectionProblems,
  sectionState,
  saveRefusal,
  staleUploads,
  SCHEMA_LIMITS,
  THEME_DEFAULTS,
  type ConfigurationDraft,
  type SectionRow,
} from "./rules";
import type { ZoteroSourceEntry } from "@/convex/zotero/sourceEntry";
import { validateOwnerSections } from "./owner-rules";

const brandRows = [
  {
    sectionKey: "identity",
    payload: {
      name: "Saved Library",
      shortName: "saved-library",
      baseUrl: "https://saved-library.libraries.example.test",
      tagline: "Evidence for better decisions",
      fundingPartners: [{ id: "fp_1", name: "Jacobs Foundation" }],
      assets: {
        logoLight: "https://assets.example.test/logo-light.svg",
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

const savedRows = [
  ...brandRows,
  { sectionKey: "navigation", payload: { links: [] } },
  { sectionKey: "features", payload: {} },
  { sectionKey: "footer", payload: {} },
  { sectionKey: "contact", payload: {} },
  {
    sectionKey: "email",
    payload: { takedownRecipient: "takedown@example.org" },
  },
  { sectionKey: "legal", payload: {} },
  { sectionKey: "notifications", payload: {} },
  { sectionKey: "collections", payload: [] },
  { sectionKey: "search", payload: {} },
  { sectionKey: "filters", payload: {} },
  { sectionKey: "topics", payload: { enabled: false } },
  { sectionKey: "sources", payload: [] },
  { sectionKey: "content", payload: {} },
  { sectionKey: "citations", payload: {} },
  { sectionKey: "exports", payload: {} },
  { sectionKey: "analytics", payload: {} },
  { sectionKey: "ai", payload: {} },
  { sectionKey: "home", payload: {} },
] as const;

function savedDraft() {
  return readDraft(savedRows);
}

describe("readDraft", () => {
  it("fills missing optional values so every control has a value", () => {
    const draft = savedDraft();
    expect(draft.identity.description).toBe("");
    expect(draft.identity.assets.logoDark).toBe("");
    expect(draft.identity.assets.faviconDark).toBe("");
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
      logoLight: "",
      logoDark: "",
      favicon: "",
      faviconDark: "",
      shareImage: "",
    });
    expect(draft.theme.colors.accent).toBe(THEME_DEFAULTS.colors.accent);
    expect(draft.institutions).toEqual([]);
  });

  it("reads a Zotero source saved without a PDF rule as the library publishes it, with the library's publish tags", () => {
    const zotero = { key: "zotero-42", provider: "zotero", groupId: "42", enabled: true, writebackEnabled: false, settings: { downloadPdfs: true } };
    const pdfPublishing = (content: SectionRow[]) =>
      (readDraft([{ sectionKey: "sources", payload: [zotero] }, ...content]).sources[0] as ZoteroSourceEntry).settings.pdfPublishing;
    expect(pdfPublishing([{ sectionKey: "content", payload: { tags: { publish: ["approved"] } } }])).toEqual({ mode: "tagged", tags: ["approved"] });
    expect(pdfPublishing([])).toEqual({ mode: "tagged", tags: ["_publish", "publishPDF"] });
  });

  it("keeps each source's screening when a saved draft is read, and reads a source saved before screening as having none", () => {
    const screening = { enabled: true, subject: "Climate adaptation in farming", keptOut: ["not-about", "passing"] };
    const draft = readDraft([{
      sectionKey: "sources",
      payload: [
        { key: "zotero-42", provider: "zotero", groupId: "42", enabled: true, writebackEnabled: false, settings: { downloadPdfs: true }, screening },
        { key: "openscholar-c1", provider: "openscholar", collectionId: "c1", enabled: true, writebackEnabled: false, settings: { name: "Mine", apiKeyMode: "platform", downloadPdfs: false }, screening },
        { key: "zotero-77", provider: "zotero", groupId: "77", enabled: true, writebackEnabled: false, settings: { downloadPdfs: true } },
      ],
    }]);
    expect(draft.sources.map((source) => source.screening)).toEqual([screening, screening, undefined]);
  });

  it("reads older brand rows into the files visitors already see", () => {
    const identity = (assets: Record<string, string>) =>
      readDraft([{ sectionKey: "identity", payload: { assets } }]).identity
        .assets;
    expect(identity({ logoDark: "dark.svg", favicon: "default.ico" })).toMatchObject({
      logoLight: "dark.svg",
      logoDark: "",
      favicon: "default.ico",
      faviconDark: "",
    });
    expect(
      identity({ favicon: "default.ico", faviconLight: "light.ico" }),
    ).toMatchObject({ favicon: "light.ico", faviconDark: "default.ico" });
    expect(
      identity({
        favicon: "default.ico",
        faviconLight: "default.ico",
        faviconDark: "dark.ico",
      }),
    ).toMatchObject({ favicon: "default.ico", faviconDark: "dark.ico" });
  });
});

describe("sectionProblems", () => {
  it("is empty for a complete draft", () => {
    const draft = savedDraft();
    expect(sectionProblems(draft, "identity")).toEqual([]);
    expect(sectionProblems(draft, "theme")).toEqual([]);
    expect(sectionProblems(draft, "institutions")).toEqual([]);
  });

  it("flags a missing name or short name and an unnamed funding partner", () => {
    const draft = savedDraft();
    draft.identity.name = "  ";
    draft.identity.shortName = " ";
    draft.identity.fundingPartners.push({ id: "fp_2", name: "" });
    expect(sectionProblems(draft, "identity")).toEqual([
      "nameMissing",
      "shortNameMissing",
      "partnerName",
    ]);
  });

  it("flags bad colours but not missing logos; the platform logo fills in", () => {
    const draft = savedDraft();
    draft.identity.assets.logoLight = "";
    draft.identity.assets.favicon = "";
    expect(sectionProblems(draft, "theme")).toEqual([]);
    draft.theme.colors.accent = "orange";
    expect(sectionProblems(draft, "theme")).toEqual(["badColour"]);
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

  it("writes the name beside the logo only when it is turned off", () => {
    const draft = savedDraft();
    draft.identity.showName = false;
    expect(changedSectionRows(draft, savedRows)[0]?.payload).toMatchObject({ showName: false });
    expect(readDraft(changedSectionRows(draft, savedRows)).identity.showName).toBe(false);
  });

  it("saves the title in search results and reads it back, and leaves it out when empty", () => {
    const draft = savedDraft();
    draft.identity.searchTitle = "Climate adaptation research and evidence";
    const rows = changedSectionRows(draft, savedRows);
    expect(rows[0]?.payload).toMatchObject({ searchTitle: "Climate adaptation research and evidence" });
    expect(readDraft(rows).identity.searchTitle).toBe("Climate adaptation research and evidence");
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
            logoLight: "https://assets.example.test/logo-light.svg",
            favicon: "https://assets.example.test/favicon.svg",
          },
        },
      },
    ]);
  });

  it("sends theme-specific favicons and leaves out missing uploads", () => {
    const draft = savedDraft();
    draft.identity.assets.favicon = "";
    draft.identity.assets.logoDark =
      "https://assets.example.test/logo-dark.svg";
    draft.identity.assets.faviconDark =
      "https://assets.example.test/favicon-dark.svg";
    const rows = changedSectionRows(draft, savedRows);
    expect(rows).toHaveLength(1);
    expect((rows[0]?.payload as { assets: unknown }).assets).toEqual({
      logoLight: "https://assets.example.test/logo-light.svg",
      logoDark: "https://assets.example.test/logo-dark.svg",
      faviconDark: "https://assets.example.test/favicon-dark.svg",
    });
  });

  it("saves a favicon on its own, and no brand images at all", () => {
    const faviconOnly = savedDraft();
    faviconOnly.identity.assets.logoLight = "";
    expect(
      (
        changedSectionRows(faviconOnly, savedRows)[0]?.payload as {
          assets: unknown;
        }
      ).assets,
    ).toEqual({ favicon: "https://assets.example.test/favicon.svg" });

    const nothing = savedDraft();
    nothing.identity.assets.logoLight = "";
    nothing.identity.assets.favicon = "";
    expect(
      (
        changedSectionRows(nothing, savedRows)[0]?.payload as {
          assets: unknown;
        }
      ).assets,
    ).toEqual({});
  });

  it("still sends an empty short name so the platform can point at it", () => {
    const draft = savedDraft();
    draft.identity.shortName = "";
    const rows = changedSectionRows(draft, savedRows);
    expect((rows[0]?.payload as { shortName?: unknown }).shortName).toBe("");
    expect(
      validateOwnerSections(rows, {
        expectedBaseUrl: "https://saved-library.libraries.example.test",
      }).issues.map((issue) => issue.pointer),
    ).toEqual(["/identity/shortName"]);
  });

  it("sends a row the platform accepts when there is no favicon", () => {
    const draft = savedDraft();
    draft.identity.assets.favicon = "";
    expect(
      validateOwnerSections(changedSectionRows(draft, savedRows), {
        expectedBaseUrl: "https://saved-library.libraries.example.test",
      }).issues,
    ).toEqual([]);
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

  it("sends a dark-mode colour only once it is set", () => {
    const draft = savedDraft();
    expect(changedSectionRows(draft, savedRows)).toEqual([]);

    draft.theme.colors.accentDark = "#60a5fa";
    const colors = (changedSectionRows(draft, savedRows)[0]?.payload as { colors: Record<string, string> }).colors;
    expect(colors.accentDark).toBe("#60a5fa");
    expect(colors).not.toHaveProperty("linkDark");

    draft.theme.colors.linkDark = "blue";
    expect(sectionProblems(draft, "theme")).toEqual(["badColour"]);
  });

  it("treats a section without a saved row as changed", () => {
    const rows = savedRows.filter((row) => row.sectionKey !== "theme");
    const draft = readDraft(rows);
    expect(
      changedSectionRows(draft, rows).map((row) => row.sectionKey),
    ).toEqual(["theme"]);
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
    draft.identity.assets.logoDark =
      "https://assets.example.test/logo-dark.svg";
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
    draft.identity.assets.logoLight = "";
    draft.theme.colors.accent = "#000000";
    const reset = resetSection(draft, savedRows, "theme");
    expect(reset.identity.name).toBe("Renamed");
    expect(reset.identity.assets.logoLight).toBe(
      "https://assets.example.test/logo-light.svg",
    );
    expect(reset.theme.colors.accent).toBe("#e68124");
    expect(sectionState(reset, savedRows, "theme")).toBe("complete");
    expect(sectionState(reset, savedRows, "identity")).toBe("edited");
  });

  it("takes the topics switch back with the rest of the search section", () => {
    const draft = savedDraft();
    draft.topics.enabled = true;
    const reset = resetSection(draft, savedRows, "search");
    expect(reset.topics.enabled).toBe(false);
    expect(sectionState(reset, savedRows, "search")).toBe("complete");
  });
});

describe("a save made elsewhere while the page is open", () => {
  const savedElsewhere = (sectionKey: string, payload: unknown, rows: readonly { sectionKey: string; payload: unknown }[] = savedRows) =>
    rows.map((row) => (row.sectionKey === sectionKey ? { sectionKey, payload } : row));
  const renamedElsewhere = savedElsewhere("identity", { ...brandRows[0].payload, name: "Their name" });

  it("keeps a section's unsaved values and takes the saved values for the others", () => {
    const draft = savedDraft();
    draft.footer.disclaimer = "Mine, not saved yet";
    const carried = carryUnsaved(draft, savedDraft(), savedRows, renamedElsewhere, []);
    expect(carried.draft.footer.disclaimer).toBe("Mine, not saved yet");
    expect(carried.draft.identity.name).toBe("Their name");
    expect(sectionState(carried.draft, renamedElsewhere, "footer")).toBe("edited");
    expect(sectionState(carried.draft, renamedElsewhere, "identity")).toBe("complete");
    expect(carried.elsewhere).toEqual([]);
    // Only the section that took new values is drawn again; the one being edited is left alone.
    expect(carried.replaced).toEqual(["identity"]);
  });

  it("names a section that was changed here and saved elsewhere, until it is saved or reset", () => {
    const draft = savedDraft();
    draft.identity.name = "My name";
    const carried = carryUnsaved(draft, savedDraft(), savedRows, renamedElsewhere, []);
    expect(carried.draft.identity.name).toBe("My name");
    expect(carried.elsewhere).toEqual(["identity"]);
    expect(carried.replaced).toEqual([]);
    // A later save of another section leaves the name unresolved, so the section stays named.
    const footerToo = savedElsewhere("footer", { disclaimer: "Theirs" }, renamedElsewhere);
    const later = carryUnsaved(carried.draft, carried.base, renamedElsewhere, footerToo, carried.elsewhere);
    expect(later.draft.identity.name).toBe("My name");
    expect(later.elsewhere).toEqual(["identity"]);
  });

  it("has nothing to say when the saved value is the one already on the page", () => {
    const draft = savedDraft();
    draft.identity.name = "Their name";
    const carried = carryUnsaved(draft, savedDraft(), savedRows, renamedElsewhere, []);
    expect(carried.elsewhere).toEqual([]);
    expect(isDirty(carried.draft, renamedElsewhere)).toBe(false);
  });

  it("does not hold on to values a library has no row for yet", () => {
    // Every section of a new library counts as changed until its rows are written; nobody typed those values.
    const draft = readDraft(brandRows);
    const carried = carryUnsaved(draft, readDraft(brandRows), brandRows, renamedElsewhere, []);
    expect(carried.draft.identity.name).toBe("Their name");
    expect(carried.elsewhere).toEqual([]);
  });

  it("does not take a row saved without ids for an edit of its own", () => {
    // Such a row is given new ids on every read, so two readings of it never match.
    const withoutIds = savedElsewhere("institutions", [{ name: "Saved institute", logoUrl: "" }]);
    const page = readDraft(withoutIds);
    const theirs = savedElsewhere("institutions", [{ name: "Their institute", logoUrl: "" }]);
    const untouched = carryUnsaved(page, page, withoutIds, theirs, []);
    expect(untouched.draft.institutions[0].name).toBe("Their institute");
    expect(untouched.elsewhere).toEqual([]);
    // Edited here, with a save elsewhere that left its row alone: kept, and nothing to say.
    const edited = structuredClone(page);
    edited.institutions[0].name = "My institute";
    const kept = carryUnsaved(edited, page, withoutIds, savedElsewhere("footer", { disclaimer: "Theirs" }, withoutIds), []);
    expect(kept.draft.institutions[0].name).toBe("My institute");
    expect(kept.elsewhere).toEqual([]);
  });

  it("keeps a feature that needs what another kept section holds", () => {
    const oneLanguage = savedElsewhere("localization", { locales: ["en-GB"], defaultLocale: "en-GB" }, platformRows);
    const draft = readDraft(oneLanguage);
    draft.localization.locales = ["en-GB", "fr"];
    draft.features.languageSwitcher = true;
    const carried = carryUnsaved(draft, readDraft(oneLanguage), oneLanguage, savedElsewhere("footer", { disclaimer: "Theirs" }, oneLanguage), []);
    expect(carried.draft.localization.locales).toEqual(["en-GB", "fr"]);
    expect(carried.draft.features.languageSwitcher).toBe(true);
    expect(carried.draft.footer.disclaimer).toBe("Theirs");
  });

  it("keeps a feature switched on here when a save elsewhere takes away what it needs, and flags it", () => {
    const withoutDownloads = savedElsewhere("features", { collections: true, collectionNotes: true, downloads: false }, platformRows);
    const page = readDraft(withoutDownloads);
    const draft = structuredClone(page);
    draft.features.downloads = true;
    const noExports = savedElsewhere("exports", { ris: false, bibtex: false, atom: false }, withoutDownloads);
    const carried = carryUnsaved(draft, page, withoutDownloads, noExports, []);
    expect(carried.draft.features.downloads).toBe(true);
    expect(carried.draft.exports.ris).toBe(false);
    expect(sectionState(carried.draft, noExports, "features")).toBe("attention");
    expect(sectionProblems(carried.draft, "features")).toEqual(["featureDependency"]);
    // The other way round: the formats were switched off here, which had switched downloads off with them.
    const withDownloads = readDraft(platformRows);
    const formatsOff = structuredClone(withDownloads);
    formatsOff.exports.ris = false;
    settleFeatures(formatsOff);
    const other = carryUnsaved(formatsOff, withDownloads, platformRows, savedElsewhere("footer", { disclaimer: "Theirs" }, platformRows), []);
    expect(other.draft.exports.ris).toBe(false);
    expect(other.draft.features.downloads).toBe(false);
    expect(sectionProblems(other.draft, "features")).toEqual([]);
  });

  it("starts again from the saved rows after this page's own save, keeping only what was typed since", () => {
    const sent = savedDraft();
    sent.footer.disclaimer = "Sent with the save";
    // The rows that follow the page's own save: whatever the platform made of what was sent.
    const own = carryUnsaved(sent, sent, savedRows, renamedElsewhere, []);
    expect(own.draft).toEqual(readDraft(renamedElsewhere));
    expect(own.elsewhere).toEqual([]);
    expect(own.replaced).toEqual(["identity", "footer"]);
    // The answer came before the rows, and a tagline was typed in between.
    const typedSince = structuredClone(sent);
    typedSince.contact.email = "typed-since@example.org";
    const late = carryUnsaved(typedSince, sent, savedRows, savedElsewhere("footer", { disclaimer: "Sent with the save" }), []);
    expect(late.draft.contact.email).toBe("typed-since@example.org");
    expect(late.draft.footer.disclaimer).toBe("Sent with the save");
    expect(late.elsewhere).toEqual([]);
  });
});

describe("staleUploads", () => {
  it("deletes a removed photo of someone written in by hand, never a team member's", () => {
    const rows = [
      ...savedRows.filter((row) => row.sectionKey !== "home"),
      {
        sectionKey: "home",
        payload: {
          people: [
            { id: "custom_amina", name: "Amina", photo: "https://assets.example.test/amina.webp" },
            { id: "user_ada", name: "Ada", photo: "https://img.clerk.example/ada.png" },
          ],
        },
      },
    ];
    const draft = readDraft(rows);
    draft.home.people = [];
    expect(staleUploads(draft, rows)).toEqual(["https://assets.example.test/amina.webp"]);
  });


  it("lists saved files the draft no longer points at", () => {
    const draft = savedDraft();
    draft.identity.assets.logoLight =
      "https://assets.example.test/logo-light-2.svg";
    const rows = savedRows.map((row) =>
      row.sectionKey === "institutions"
        ? {
            sectionKey: "institutions",
            payload: [
              {
                id: "inst_1",
                name: "EdTech Hub",
                logoUrl: "https://assets.example.test/edtech-hub.png",
              },
            ],
          }
        : row,
    );
    draft.institutions = [];
    expect(staleUploads(draft, rows)).toEqual([
      "https://assets.example.test/logo-light.svg",
      "https://assets.example.test/edtech-hub.png",
    ]);
  });

  it("keeps a file that is still used somewhere in the draft", () => {
    const draft = savedDraft();
    draft.identity.assets.logoDark = draft.identity.assets.logoLight;
    draft.identity.assets.logoLight =
      "https://assets.example.test/logo-light-2.svg";
    expect(staleUploads(draft, savedRows)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Plan 06: navigation, footer, contact & legal                         */
/* ------------------------------------------------------------------ */

const contentRows = [
  ...savedRows.filter(
    (row) =>
      ![
        "navigation",
        "features",
        "footer",
        "contact",
        "email",
        "legal",
      ].includes(row.sectionKey),
  ),
  {
    sectionKey: "navigation",
    payload: {
      links: [
        {
          id: "nav_1",
          label: "Library",
          href: "/lib",
          icon: "LibraryIcon",
          target: "self",
          visible: true,
          children: [
            {
              id: "nav_1a",
              label: "AI",
              href: "/lib?collections=COL1",
              target: "self",
              visible: true,
            },
          ],
        },
      ],
    },
  },
  {
    sectionKey: "features",
    payload: { navbarSearch: false, collections: true },
  },
  {
    sectionKey: "footer",
    payload: {
      sections: [
        {
          id: "fs_1",
          title: "Explore",
          links: [{ id: "fl_1", label: "Map", href: "/map" }],
        },
      ],
      socialLinks: [
        { provider: "github", href: "https://github.com/OpenDevEd" },
      ],
      funders: [
        {
          id: "fu_1",
          name: "Jacobs Foundation",
          logoUrl: "https://assets.example.test/jacobs.svg",
        },
      ],
      disclaimer: "Views are the authors' own.",
      attribution: "",
      poweredBy: true,
    },
  },
  {
    sectionKey: "contact",
    payload: { email: "hello@example.org", phone: "+442071234567" },
  },
  {
    sectionKey: "email",
    payload: { takedownRecipient: "takedown@example.org" },
  },
  {
    sectionKey: "legal",
    payload: {
      privacyMarkdown: "# Privacy\n\nWe keep little.",
      cookiePolicy: "https://example.org/cookies",
    },
  },
] as const;

describe("readDraft for the content sections", () => {
  it("reads links as targets, the navbar search flag, and legal sources", () => {
    const draft = readDraft(contentRows);
    expect(draft.navigation.links[0]?.target).toEqual({
      kind: "page",
      page: "library",
    });
    expect(draft.navigation.links[0]?.children[0]?.target).toEqual({
      kind: "collection",
      collectionId: "COL1",
    });
    expect(draft.features.navbarSearch).toBe(false);
    expect(draft.features.collections).toBe(true);
    expect(draft.features.downloads).toBe(false);
    expect(draft.footer.social).toEqual({
      github: "https://github.com/OpenDevEd",
    });
    expect(draft.footer.funders[0]).toEqual({
      id: "fu_1",
      name: "Jacobs Foundation",
      logoUrl: "https://assets.example.test/jacobs.svg",
      href: "",
    });
    expect(draft.contact.phone).toBe("+442071234567");
    expect(draft.email.takedownRecipient).toBe("takedown@example.org");
    expect(draft.legal.privacy).toEqual({
      kind: "text",
      text: "# Privacy\n\nWe keep little.",
    });
    expect(draft.legal.cookie).toEqual({
      kind: "url",
      url: "https://example.org/cookies",
    });
    expect(draft.legal.terms).toEqual({ kind: "none" });
  });

  it("starts with the schema defaults when the rows are missing", () => {
    const draft = readDraft(savedRows);
    expect(draft.navigation.links).toEqual([]);
    expect(draft.features.navbarSearch).toBe(true);
    expect(draft.footer.poweredBy).toBe(true);
    expect(draft.legal.privacy).toEqual({ kind: "none" });
    expect(SCHEMA_LIMITS.navigation.links).toBe(12);
    expect(SCHEMA_LIMITS.footer.sections).toBe(6);
    expect(SCHEMA_LIMITS.footer.disclaimer).toBe(2000);
  });
});

describe("sectionProblems for the content sections", () => {
  it("flags links without a label, a bad address, or no collection", () => {
    const draft = readDraft(contentRows);
    draft.navigation.links[0]!.label = "";
    draft.navigation.links[0]!.children[0]!.target = {
      kind: "collection",
      collectionId: "",
    };
    draft.navigation.links.push({
      id: "nav_2",
      label: "About",
      target: { kind: "url", url: "about" },
      icon: "",
      newTab: true,
      visible: true,
      children: [],
    });
    expect(sectionProblems(draft, "navigation")).toEqual([
      "linkLabel",
      "linkCollection",
      "linkUrl",
    ]);
  });

  it("flags footer sections, social addresses and funders", () => {
    const draft = readDraft(contentRows);
    draft.footer.sections[0]!.title = " ";
    draft.footer.social.twitter = "x.com/opendeved";
    draft.footer.funders[0]!.name = "";
    draft.footer.funders[0]!.href = "jacobsfoundation.org";
    expect(sectionProblems(draft, "footer")).toEqual([
      "footerTitle",
      "socialUrl",
      "funderName",
      "funderUrl",
    ]);
  });

  it("checks a recipient only while its switch is on", () => {
    const draft = readDraft(contentRows);
    expect(draft.email).toEqual({
      contactRecipient: null,
      takedownRecipient: "takedown@example.org",
    });
    draft.email.takedownRecipient = null;
    expect(sectionProblems(draft, "contact")).toEqual([]);
    expect(changedSectionRows(draft, contentRows)).toEqual([
      { sectionKey: "email", payload: {} },
    ]);
    draft.email.contactRecipient = "";
    expect(sectionProblems(draft, "contact")).toEqual(["contactRecipient"]);
    draft.email.contactRecipient = "team@example.org";
    expect(sectionProblems(draft, "contact")).toEqual([]);
    expect(changedSectionRows(draft, contentRows)).toEqual([
      {
        sectionKey: "email",
        payload: { contactRecipient: "team@example.org" },
      },
    ]);
  });

  it("flags an invalid takedown recipient and checks the other contact values", () => {
    const draft = readDraft(contentRows);
    draft.email.takedownRecipient = "";
    draft.contact.email = "hello@";
    draft.contact.phone = "020 7123 4567";
    draft.legal.terms = { kind: "url", url: "example.org/terms" };
    expect(sectionProblems(draft, "contact")).toEqual([
      "takedownRecipient",
      "contactEmail",
      "phone",
      "legalUrl",
    ]);
  });

  it("accepts a complete contact section", () => {
    expect(sectionProblems(readDraft(contentRows), "contact")).toEqual([]);
    expect(sectionProblems(readDraft(contentRows), "footer")).toEqual([]);
    expect(sectionProblems(readDraft(contentRows), "navigation")).toEqual([]);
  });
});

describe("changedSectionRows for the content sections", () => {
  it("writes the navbar search switch to the features row", () => {
    const draft = readDraft(contentRows);
    draft.features.navbarSearch = true;
    const rows = changedSectionRows(draft, contentRows);
    expect(rows.map((row) => row.sectionKey)).toEqual(["features"]);
    expect(rows[0]?.payload).toMatchObject({
      navbarSearch: true,
      collections: true,
      downloads: false,
    });
    expect(sectionState(draft, contentRows, "navigation")).toBe("edited");
  });

  it("writes the home page switch only when it is on", () => {
    const draft = readDraft(contentRows);
    draft.features.navbarSearch = true;
    const [off] = changedSectionRows(draft, contentRows);
    // Off is the default; older backends and library software refuse the key.
    expect(off?.payload).not.toHaveProperty("homePage");

    draft.features.homePage = true;
    const [on] = changedSectionRows(draft, contentRows);
    expect(on?.payload).toMatchObject({ homePage: true });
  });

  it("writes links with runtime hrefs and dropdown children", () => {
    const draft = readDraft(contentRows);
    draft.navigation.links[0]!.children.push({
      id: "nav_1b",
      label: "About",
      target: { kind: "url", url: "https://example.org/about" },
      icon: "",
      newTab: true,
      visible: true,
      children: [],
    });
    const rows = changedSectionRows(draft, contentRows);
    expect(rows).toEqual([
      {
        sectionKey: "navigation",
        payload: {
          links: [
            {
              id: "nav_1",
              label: "Library",
              href: "/lib",
              icon: "LibraryIcon",
              target: "self",
              visible: true,
              children: [
                {
                  id: "nav_1a",
                  label: "AI",
                  href: "/lib?collections=COL1",
                  target: "self",
                  visible: true,
                },
                {
                  id: "nav_1b",
                  label: "About",
                  href: "https://example.org/about",
                  target: "blank",
                  visible: true,
                },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("writes the footer with social rows and keeps poweredBy on", () => {
    const draft = readDraft(contentRows);
    draft.footer.social.bluesky = "https://bsky.app/profile/opendeved";
    delete draft.footer.social.github;
    draft.footer.funders[0]!.href = "https://jacobsfoundation.org";
    draft.footer.funders[0]!.logoUrl = "";
    const rows = changedSectionRows(draft, contentRows);
    expect(rows).toEqual([
      {
        sectionKey: "footer",
        payload: {
          sections: [
            {
              id: "fs_1",
              title: "Explore",
              links: [
                {
                  id: "fl_1",
                  label: "Map",
                  href: "/map",
                  target: "self",
                  visible: true,
                },
              ],
            },
          ],
          socialLinks: [
            { provider: "bluesky", href: "https://bsky.app/profile/opendeved" },
          ],
          funders: [
            {
              id: "fu_1",
              name: "Jacobs Foundation",
              href: "https://jacobsfoundation.org",
            },
          ],
          disclaimer: "Views are the authors' own.",
          attribution: "",
          poweredBy: true,
        },
      },
    ]);
  });

  it("writes contact, email and legal rows from the one card", () => {
    const draft = readDraft(contentRows);
    draft.contact.address = "";
    draft.email.contactRecipient = "team@example.org";
    draft.legal.privacy = { kind: "url", url: "https://example.org/privacy" };
    draft.legal.cookie = { kind: "none" };
    draft.legal.terms = { kind: "text", text: "# Terms" };
    const rows = changedSectionRows(draft, contentRows);
    expect(rows).toEqual([
      {
        sectionKey: "email",
        payload: {
          contactRecipient: "team@example.org",
          takedownRecipient: "takedown@example.org",
        },
      },
      {
        sectionKey: "legal",
        payload: {
          privacyPolicy: "https://example.org/privacy",
          termsMarkdown: "# Terms",
        },
      },
    ]);
  });

  it("resets the navigation card including the navbar search switch", () => {
    const draft = readDraft(contentRows);
    draft.features.navbarSearch = true;
    draft.features.themeSwitcher = true;
    draft.navigation.links = [];
    const reset = resetSection(draft, contentRows, "navigation");
    expect(reset.navigation.links).toHaveLength(1);
    expect(reset.features.navbarSearch).toBe(false);
    expect(reset.features.themeSwitcher).toBe(true);
  });

  it("counts funder logos as uploads", () => {
    const draft = readDraft(contentRows);
    draft.footer.funders = [];
    expect(staleUploads(draft, contentRows)).toEqual([
      "https://assets.example.test/jacobs.svg",
    ]);
  });

  it("sends a refused save to the card that owns the value", () => {
    expect(
      saveRefusal(
        "/identity/name",
        "/identity/name: This name is already taken.",
      ),
    ).toEqual({
      card: "identity",
      message: "This name is already taken.",
    });
    expect(
      saveRefusal(
        "/email/smtp",
        "/email/smtp: The mail server is set by the platform and cannot be saved.",
      ),
    ).toEqual({
      card: "contact",
      message: "The mail server is set by the platform and cannot be saved.",
    });
  });

  it("sends a refused brand image to the Theme card, which edits it", () => {
    for (const pointer of [
      "/identity/assets",
      "/identity/assets/favicon",
      "/identity/assets/logoDark",
      "/identity/assets/shareImage",
    ]) {
      expect(
        saveRefusal(pointer, `${pointer}: Value must match the uri format.`),
      ).toEqual({
        card: "theme",
        message: "Value must match the uri format.",
      });
    }
  });

  it("keeps a refused save without a pointer out of every card", () => {
    expect(saveRefusal(undefined, "Nothing to save")).toEqual({
      card: null,
      message: "Nothing to save",
    });
    expect(saveRefusal("/services/database", "Set by the platform.")).toEqual({
      card: null,
      message: "Set by the platform.",
    });
    expect(saveRefusal("/identity/name", "")).toBeNull();
    expect(saveRefusal("/identity/name", undefined)).toBeNull();
  });

  it("points an email issue at the contact card", () => {
    expect(cardForRow("email")).toBe("contact");
    expect(cardForRow("legal")).toBe("contact");
    expect(cardForRow("features")).toBe("features");
    expect(cardForRow("topics")).toBe("search");
    expect(cardForRow("sources")).toBe("sources");
    expect(cardForRow("services")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Plan 06: collections, search & filters, sources                     */
/* ------------------------------------------------------------------ */

const discoveryRows = [
  ...savedRows.filter(
    (row) =>
      !["collections", "search", "filters", "sources", "content"].includes(
        row.sectionKey,
      ),
  ),
  {
    sectionKey: "collections",
    payload: [
      { id: "COL2", title: "Health", order: 1 },
      { id: "COL1", order: 0 },
    ],
  },
  {
    sectionKey: "search",
    payload: {
      fullText: false,
      scopes: ["title", "authors"],
      defaultScope: "title",
    },
  },
  {
    sectionKey: "filters",
    payload: {
      institution: {
        mode: "facet-with-featured-value",
        label: "Partners",
        featuredValue: "EdTech Hub",
      },
      years: { enabled: true },
    },
  },
  {
    sectionKey: "sources",
    payload: [
      {
        key: "zotero-42",
        provider: "zotero",
        groupId: "42",
        enabled: true,
        writebackEnabled: true,
      },
    ],
  },
  {
    sectionKey: "content",
    payload: { tags: { publish: ["_publish"], hidden: [] } },
  },
] as const;

describe("readDraft for the discovery sections", () => {
  it("reads search, filters, sources and tag rules", () => {
    const draft = readDraft(discoveryRows);
    expect(draft.search).toEqual({
      fullText: false,
      tags: true,
      country: true,
      scopes: ["title", "authors"],
      defaultScope: "title",
    });
    expect(draft.filters.institution).toEqual({
      mode: "facet-with-featured-value",
      label: "Partners",
      featuredValue: "EdTech Hub",
    });
    expect(draft.filters.years).toEqual({ enabled: true });
    expect(draft.topics).toEqual({ enabled: false });
    expect(draft.filters.collectionsExpanded).toBe(true);
    expect(draft.sources).toEqual([
      {
        key: "zotero-42",
        provider: "zotero",
        groupId: "42",
        enabled: true,
        writebackEnabled: true,
        settings: { downloadPdfs: true, pdfPublishing: { mode: "tagged", tags: ["_publish"] } },
      },
    ]);
    expect(draft.content.tags).toEqual({ publish: ["_publish"], hidden: [] });
    expect(collectionOptions(draft)).toEqual([
      { id: "COL2", title: "Health" },
      { id: "COL1", title: undefined },
    ]);
  });

  it("uses the runtime defaults when the rows are missing", () => {
    const draft = readDraft(savedRows);
    expect(draft.search.scopes).toEqual(SEARCH_SCOPES);
    expect(draft.search.defaultScope).toBe(SEARCH_SCOPES[0]);
    expect(draft.filters.institution).toEqual({
      mode: "facet",
      label: "institutions",
      featuredValue: "",
    });
    expect(draft.filters.years).toEqual({ enabled: true });
    expect(draft.filters.sources).toEqual({ enabled: true, label: "sources" });
    expect(draft.filters.tagFilters).toEqual([]);
    expect(draft.filters.collectionsMatch).toEqual({ default: "all", readerSwitch: false });
    expect(draft.filters.studyTypes).toEqual({ enabled: true });
    expect(draft.sources).toEqual([]);
    expect(draft.content.tags).toEqual({});
  });
});

describe("sectionProblems for the discovery sections", () => {
  it("flags scopes, the default scope and the pinned institution", () => {
    const draft = readDraft(discoveryRows);
    draft.search.defaultScope = "everywhere";
    draft.filters.institution.featuredValue = " ";
    expect(sectionProblems(draft, "search")).toEqual([
      "defaultScope",
      "featuredInstitution",
    ]);
    draft.search.scopes = [];
    expect(sectionProblems(draft, "search")[0]).toBe("searchScopes");
  });

  it("flags a blank sources heading only while the sources filter is on", () => {
    const draft = readDraft(discoveryRows);
    draft.filters.sources.label = "  ";
    expect(sectionProblems(draft, "search")).toEqual(["sourcesLabel"]);
    draft.filters.sources.enabled = false;
    expect(sectionProblems(draft, "search")).toEqual([]);
  });

  it("flags a tag filter without a name, or an entry without a tag", () => {
    const draft = readDraft(discoveryRows);
    draft.filters.tagFilters = [{ id: "status", label: "Status", enabled: true, placement: "card", options: [{ value: "Reviewed", prefix: false, label: "" }], defaults: [] }];
    expect(sectionProblems(draft, "search")).toEqual([]);
    draft.filters.tagFilters[0]!.label = " ";
    expect(sectionProblems(draft, "search")).toEqual(["tagFilters"]);
    draft.filters.tagFilters[0]!.label = "Status";
    draft.filters.tagFilters[0]!.options[0]!.value = "";
    expect(sectionProblems(draft, "search")).toEqual(["tagFilters"]);
  });

  it("ignores the pin when the institution mode is plain", () => {
    const draft = readDraft(discoveryRows);
    draft.filters.years.enabled = false;
    draft.filters.institution.mode = "facet";
    draft.filters.institution.featuredValue = "";
    expect(sectionProblems(draft, "search")).toEqual([]);
  });

  it("flags a broken tag rule and drops tag keys the runtime does not know", () => {
    const draft = readDraft(discoveryRows);
    draft.content.tags.publish = [];
    expect(sectionProblems(draft, "sources")).toEqual(["tagRules"]);
    const stray = readDraft([
      ...discoveryRows.filter((row) => row.sectionKey !== "content"),
      {
        sectionKey: "content",
        payload: { tags: { hidden: ["hide"], bogus: ["x"] } },
      },
    ]);
    expect(stray.content.tags).toEqual({ hidden: ["hide"] });
  });
});

describe("changedSectionRows for the discovery sections", () => {
  it("writes search, filters and topics from the Search card", () => {
    const draft = readDraft(discoveryRows);
    draft.search.fullText = true;
    draft.filters.institution.mode = "facet";
    draft.filters.uncertainStudyTypes = "separate";
    draft.filters.sources.label = "Topic areas";
    draft.filters.tagFilters = [
      {
        id: "domain",
        label: "Domain",
        enabled: true,
        placement: "picker",
        options: [{ value: "Domain: ", prefix: true, label: "" }, { value: "Domain: AIG", prefix: false, label: "Item Generation" }],
        defaults: ["Domain: AIG"],
      },
    ];
    draft.filters.collectionsMatch = { default: "any", readerSwitch: true };
    draft.topics.enabled = true;
    const rows = changedSectionRows(draft, discoveryRows);
    expect(rows).toEqual([
      {
        sectionKey: "search",
        payload: {
          fullText: true,
          tags: true,
          country: true,
          scopes: ["title", "authors"],
          defaultScope: "title",
        },
      },
      {
        sectionKey: "filters",
        payload: {
          institution: { mode: "facet", label: "Partners" },
          sources: { enabled: true, label: "Topic areas" },
          // A label left empty stays out, so readers see the tag without its prefix.
          tagFilters: [
            {
              id: "domain",
              label: "Domain",
              enabled: true,
              placement: "picker",
              options: [{ value: "Domain: ", prefix: true }, { value: "Domain: AIG", prefix: false, label: "Item Generation" }],
              defaults: ["Domain: AIG"],
            },
          ],
          collectionsMatch: { default: "any", readerSwitch: true },
          studyTypes: { enabled: true },
          collectionsExpanded: true,
          uncertainStudyTypes: "separate",
          years: { enabled: true },
        },
      },
      { sectionKey: "topics", payload: { enabled: true } },
    ]);
    expect(sectionState(draft, discoveryRows, "search")).toBe("edited");
  });

  it("writes sources and tag rules from the Sources card, and resets both", () => {
    const draft = readDraft(discoveryRows);
    draft.sources[0]!.writebackEnabled = false;
    draft.content.tags.hidden = ["hide"];
    const rows = changedSectionRows(draft, discoveryRows);
    expect(rows.map((row) => row.sectionKey)).toEqual(["sources", "content"]);
    expect(rows[1]?.payload).toEqual({
      tags: { publish: ["_publish"], hidden: ["hide"] },
      openAccessLabel: "open",
    });
    const reset = resetSection(draft, discoveryRows, "sources");
    expect(reset.sources[0]?.writebackEnabled).toBe(true);
    expect(reset.content.tags.hidden).toEqual([]);
  });

  it("writes the open-access label from the Features card and resets it apart from the tag rules", () => {
    const draft = readDraft(discoveryRows);
    draft.content.openAccessLabel = "both";
    draft.content.tags.hidden = ["hide"];
    expect(changedSectionRows(draft, discoveryRows)).toEqual([
      {
        sectionKey: "content",
        payload: { tags: { publish: ["_publish"], hidden: ["hide"] }, openAccessLabel: "both" },
      },
    ]);
    expect(sectionState(draft, discoveryRows, "features")).toBe("edited");
    expect(resetSection(draft, discoveryRows, "features").content).toEqual({
      tags: { publish: ["_publish"], hidden: ["hide"] },
      openAccessLabel: "open",
    });
    expect(resetSection(draft, discoveryRows, "sources").content).toEqual({
      tags: { publish: ["_publish"], hidden: [] },
      openAccessLabel: "both",
    });
    // A refused label belongs to the Features card; refused tag rules stay with Sources.
    expect(saveRefusal("/content/openAccessLabel", "Invalid option")?.card).toBe("features");
    expect(saveRefusal("/content/tags/hidden", "Invalid tag")?.card).toBe("sources");
    const unknown = readDraft([
      ...discoveryRows.filter((row) => row.sectionKey !== "content"),
      { sectionKey: "content", payload: { tags: {}, openAccessLabel: "sometimes" } },
    ]);
    expect(unknown.content.openAccessLabel).toBe("open");
  });

  it("writes collections as saved by the picker", () => {
    const draft = readDraft(discoveryRows);
    draft.collections.push({
      id: "COL3",
      title: "Policy",
      enabled: false,
      order: 2,
    });
    expect(changedSectionRows(draft, discoveryRows)).toEqual([
      {
        sectionKey: "collections",
        payload: [
          { id: "COL2", title: "Health", order: 1 },
          { id: "COL1", order: 0 },
          { id: "COL3", title: "Policy", enabled: false, order: 2 },
        ],
      },
    ]);
    expect(cardForRow("filters")).toBe("search");
    expect(cardForRow("content")).toBe("sources");
  });
});

describe("legal text chosen but not uploaded yet", () => {
  it("flags the section and writes nothing for that page", () => {
    const draft = readDraft(contentRows);
    draft.legal.terms = { kind: "text", text: "" };
    expect(sectionProblems(draft, "contact")).toEqual(["legalText"]);
    expect(changedSectionRows(draft, contentRows)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Plan 06: citations & exports, features, languages, analytics        */
/* ------------------------------------------------------------------ */

const platformRows = [
  ...savedRows.filter(
    (row) =>
      ![
        "features",
        "localization",
        "search",
        "filters",
        "citations",
        "exports",
        "analytics",
      ].includes(row.sectionKey),
  ),
  { sectionKey: "search", payload: { country: false } },
  { sectionKey: "filters", payload: { years: { enabled: false } } },
  {
    sectionKey: "features",
    payload: { collections: true, collectionNotes: true, downloads: true },
  },
  { sectionKey: "citations", payload: { showUrl: true } },
  { sectionKey: "exports", payload: { ris: true, bibtex: false, atom: false } },
  {
    sectionKey: "localization",
    payload: {
      locales: ["fr", "en-GB"],
      defaultLocale: "en-GB",
      localePriority: ["en-GB"],
    },
  },
  {
    sectionKey: "analytics",
    payload: {
      posthog: {
        host: "https://eu.i.posthog.com",
        key: "phc_12345678901234567890",
      },
    },
  },
] as const;

describe("readDraft for the platform sections", () => {
  it("reads export switches, languages and the analytics switches", () => {
    const draft = readDraft(platformRows);
    expect(draft.citations.showUrl).toBe(true);
    expect(draft.exports).toEqual({ ris: true, bibtex: false, atom: false });
    expect(draft.localization).toEqual({
      locales: ["fr", "en-GB"],
      defaultLocale: "en-GB",
      detectLocale: false,
      localePriority: ["en-GB", "fr"],
    });
    expect(draft.analytics).toEqual({
      posthog: {
        enabled: true,
        host: "https://eu.i.posthog.com",
        uiHost: "",
        key: "phc_12345678901234567890",
      },
      google: { enabled: false, measurementId: "" },
      consentPolicyVersion: 1,
    });
    expect(readDraft(savedRows).analytics.posthog).toEqual({
      enabled: false,
      host: "",
      uiHost: "",
      key: "",
    });
    expect(readDraft(savedRows).exports).toEqual({
      ris: true,
      bibtex: true,
      atom: false,
    });
  });
});

describe("feature rules", () => {
  it("explains why a feature cannot be on and flags the card", () => {
    const draft = readDraft(platformRows);
    expect(featureBlock(draft, "countryFocus")).toEqual({
      kind: "search",
      option: "country",
    });
    expect(featureBlock(draft, "yearsDropdown")).toEqual({ kind: "years" });
    expect(featureBlock(draft, "atomFeed")).toEqual({ kind: "atom" });
    expect(featureBlock(draft, "downloads")).toBeNull();
    expect(featureBlock(draft, "languageSwitcher")).toBeNull();
    expect(sectionProblems(draft, "features")).toEqual([]);
    draft.exports.ris = false;
    expect(featureBlock(draft, "downloads")).toEqual({ kind: "exports" });
    expect(sectionProblems(draft, "features")).toEqual(["featureDependency"]);
    draft.exports.bibtex = true;
    expect(featureBlock(draft, "downloads")).toBeNull();
  });

  it("turns dependants off when a reset takes their requirement away", () => {
    const draft = readDraft(platformRows);
    draft.exports.atom = true;
    draft.features.atomFeed = true;
    draft.localization.locales = ["en-GB", "fr"];
    draft.features.languageSwitcher = true;
    const afterCitations = resetSection(draft, platformRows, "citations");
    expect(afterCitations.features.atomFeed).toBe(false);
    expect(afterCitations.features.languageSwitcher).toBe(true);
    const savedOneLanguage = platformRows.map((row) =>
      row.sectionKey === "localization"
        ? {
            sectionKey: "localization",
            payload: { locales: ["en-GB"], defaultLocale: "en-GB" },
          }
        : row,
    );
    expect(
      resetSection(draft, savedOneLanguage, "languages").features
        .languageSwitcher,
    ).toBe(false);
  });

  it("turns dependent features off when their requirement goes away", () => {
    const draft = readDraft(platformRows);
    draft.features.collections = false;
    draft.exports.ris = false;
    settleFeatures(draft);
    expect(draft.features.collectionNotes).toBe(false);
    expect(draft.features.downloads).toBe(false);
    expect(sectionProblems(draft, "features")).toEqual([]);
  });
});

describe("changedSectionRows for the platform sections", () => {
  it("rewrites an exports row that still holds file addresses even when nothing else changed", () => {
    const stale = platformRows.map((row) =>
      row.sectionKey === "exports"
        ? {
            sectionKey: "exports",
            payload: { ris: "https://feeds.example.test/library.ris" },
          }
        : row,
    );
    const draft = readDraft(stale);
    expect(draft.exports).toEqual({ ris: true, bibtex: true, atom: false });
    expect(changedSectionRows(draft, stale)).toEqual([
      {
        sectionKey: "exports",
        payload: { ris: true, bibtex: true, atom: false },
      },
    ]);
  });

  it("saves the export switches as one row and reads the schema defaults when the row is empty", () => {
    const draft = readDraft(platformRows);
    draft.exports.atom = true;
    draft.citations.showUrl = false;
    const rows = changedSectionRows(draft, platformRows);
    expect(rows).toEqual([
      { sectionKey: "citations", payload: { showUrl: false } },
      {
        sectionKey: "exports",
        payload: { ris: true, bibtex: false, atom: true },
      },
    ]);
    const fresh = readDraft(
      platformRows.map((row) =>
        row.sectionKey === "exports"
          ? { sectionKey: "exports", payload: {} }
          : row,
      ),
    );
    expect(fresh.exports).toEqual({ ris: true, bibtex: true, atom: false });
  });

  it("keeps the navbar search flag on the Navigation card and the rest on Features", () => {
    const draft = readDraft(platformRows);
    draft.features.navbarSearch = false;
    expect(sectionState(draft, platformRows, "navigation")).toBe("edited");
    expect(sectionState(draft, platformRows, "features")).toBe("complete");
    draft.features.themeSwitcher = true;
    expect(sectionState(draft, platformRows, "features")).toBe("edited");
    expect(
      changedSectionRows(draft, platformRows).map((row) => row.sectionKey),
    ).toEqual(["features"]);
    const reset = resetSection(draft, platformRows, "features");
    expect(reset.features.themeSwitcher).toBe(false);
    expect(reset.features.navbarSearch).toBe(false);
  });

  it("writes languages and flags a default that is not offered", () => {
    const draft = readDraft(platformRows);
    draft.localization.locales = ["fr"];
    draft.localization.localePriority = ["fr"];
    expect(sectionProblems(draft, "languages")).toEqual(["languages"]);
    draft.localization.defaultLocale = "fr";
    draft.localization.detectLocale = true;
    expect(sectionProblems(draft, "languages")).toEqual([]);
    expect(changedSectionRows(draft, platformRows)).toEqual([
      {
        sectionKey: "localization",
        payload: {
          locales: ["fr"],
          defaultLocale: "fr",
          detectLocale: true,
          localePriority: ["fr"],
        },
      },
    ]);
  });

  it("writes both analytics providers when both are on and checks their keys", () => {
    const draft = readDraft(platformRows);
    expect(draft.analytics).toEqual({
      posthog: {
        enabled: true,
        host: "https://eu.i.posthog.com",
        uiHost: "",
        key: "phc_12345678901234567890",
      },
      google: { enabled: false, measurementId: "" },
      consentPolicyVersion: 1,
    });
    draft.analytics.google.enabled = true;
    expect(sectionProblems(draft, "analytics")).toEqual(["google"]);
    draft.analytics.google.measurementId = "G-12AB";
    expect(sectionProblems(draft, "analytics")).toEqual([]);
    expect(changedSectionRows(draft, platformRows)).toEqual([
      {
        sectionKey: "analytics",
        payload: {
          posthog: {
            host: "https://eu.i.posthog.com",
            key: "phc_12345678901234567890",
          },
          google: { measurementId: "G-12AB" },
        },
      },
    ]);
    draft.analytics.google.measurementId = "UA-1";
    expect(sectionProblems(draft, "analytics")).toEqual(["google"]);
    draft.analytics.google.enabled = false;
    draft.analytics.posthog.key = "nope";
    expect(sectionProblems(draft, "analytics")).toEqual(["posthog"]);
    draft.analytics.posthog.key = "phc_short";
    expect(sectionProblems(draft, "analytics")).toEqual(["posthog"]);
    draft.analytics.posthog.enabled = false;
    expect(sectionProblems(draft, "analytics")).toEqual([]);
    expect(changedSectionRows(draft, platformRows)).toEqual([
      { sectionKey: "analytics", payload: {} },
    ]);
    expect(cardForRow("exports")).toBe("citations");
    expect(cardForRow("localization")).toBe("languages");
    expect(cardForRow("features")).toBe("features");
  });
});

/* ------------------------------------------------------------------ */
/* Plan 15: AI answers and the two analytics fields                    */
/* ------------------------------------------------------------------ */

const approvedModel = TEST_AI_MODELS[0]!;
const secondApprovedModel = TEST_AI_MODELS[1]!;

const aiRows = [
  ...savedRows.filter(
    (row) => row.sectionKey !== "features" && row.sectionKey !== "ai",
  ),
  { sectionKey: "features", payload: { ai: true } },
  {
    sectionKey: "ai",
    payload: {
      providers: [
        {
          provider: AI_PROVIDER,
          enabled: true,
          models: [approvedModel],
          defaultModel: approvedModel,
        },
      ],
    },
  },
];

describe("AI answers", () => {
  it("reads no key and no model from a library that has never saved one", () => {
    const draft = savedDraft();
    expect(draft.features.ai).toBe(false);
    expect(draft.ai).toEqual({ keySaved: false, models: [], defaultModel: "" });
    expect(sectionProblems(draft, "ai")).toEqual([]);
  });

  it("asks for a key and a model as soon as AI answers are on", () => {
    const draft = savedDraft();
    draft.features.ai = true;
    expect(sectionProblems(draft, "ai")).toEqual(["aiKey", "aiModel"]);
    draft.ai.keySaved = true;
    expect(sectionProblems(draft, "ai")).toEqual(["aiModel"]);
    draft.ai.models = [approvedModel];
    draft.ai.defaultModel = approvedModel;
    expect(sectionProblems(draft, "ai")).toEqual([]);
  });

  it("accepts an approved model and writes exactly one provider entry", () => {
    const draft = savedDraft();
    draft.features.ai = true;
    draft.ai.keySaved = true;
    draft.ai.models = [secondApprovedModel, approvedModel];
    draft.ai.defaultModel = approvedModel;
    expect(sectionProblems(draft, "ai")).toEqual([]);
    const rows = changedSectionRows(draft, savedRows);
    expect(
      rows.find((row) => row.sectionKey === "features")?.payload,
    ).toMatchObject({ ai: true });
    expect(rows.find((row) => row.sectionKey === "ai")).toEqual({
      sectionKey: "ai",
      payload: {
        providers: [
          {
            provider: AI_PROVIDER,
            enabled: true,
            models: [secondApprovedModel, approvedModel],
            defaultModel: approvedModel,
          },
        ],
      },
    });
  });

  it("reads a saved provider entry back and clears the row when AI goes off", () => {
    const draft = readDraft(aiRows);
    expect(draft.features.ai).toBe(true);
    expect(draft.ai.models).toEqual([approvedModel]);
    expect(draft.ai.defaultModel).toBe(approvedModel);
    expect(sectionChanged(draft, aiRows, "ai")).toBe(false);
    draft.features.ai = false;
    expect(sectionProblems(draft, "ai")).toEqual([]);
    expect(sectionState(draft, aiRows, "ai")).toBe("edited");
    // Switching off clears the model configuration from the saved provider.
    expect(changedSectionRows(draft, aiRows)).toContainEqual({
      sectionKey: "ai",
      payload: {
        providers: [{ provider: AI_PROVIDER, enabled: false, models: [] }],
      },
    });
  });

  it("puts the AI card back the way it was saved", () => {
    const draft = readDraft(aiRows);
    draft.features.ai = false;
    draft.ai.models = [];
    draft.ai.defaultModel = "";
    const back = resetSection(draft, aiRows, "ai");
    expect(back.features.ai).toBe(true);
    expect(back.ai.models).toEqual([approvedModel]);
    expect(back.ai.defaultModel).toBe(approvedModel);
  });

  it("never lets a stored key reach a saved row", () => {
    const draft = readDraft(aiRows);
    draft.ai.keySaved = true;
    expect(JSON.stringify(changedSectionRows(draft, aiRows))).not.toContain(
      "apiKey",
    );
    expect(cardForRow("ai")).toBe("ai");
    expect(sectionChanged(draft, aiRows, "ai")).toBe(false);
  });
});

describe("the analytics fields the runtime gained", () => {
  it("writes a session-recording address only with a PostHog host", () => {
    const draft = readDraft(platformRows);
    draft.analytics.posthog.uiHost = "not a url";
    expect(sectionProblems(draft, "analytics")).toEqual(["posthogUiHost"]);
    draft.analytics.posthog.uiHost = "https://eu.posthog.com";
    expect(sectionProblems(draft, "analytics")).toEqual([]);
    // The runtime refuses a recordings address without a host, so a host that
    // is not an address keeps the recordings address out of the row.
    const noHost = readDraft(platformRows);
    noHost.analytics.posthog.host = "eu.i.posthog.com";
    noHost.analytics.posthog.uiHost = "https://eu.posthog.com";
    expect(
      changedSectionRows(noHost, platformRows).find(
        (row) => row.sectionKey === "analytics",
      )?.payload,
    ).toEqual({
      posthog: {
        host: "eu.i.posthog.com",
        key: "phc_12345678901234567890",
      },
    });
    expect(changedSectionRows(draft, platformRows)).toEqual([
      {
        sectionKey: "analytics",
        payload: {
          posthog: {
            host: "https://eu.i.posthog.com",
            uiHost: "https://eu.posthog.com",
            key: "phc_12345678901234567890",
          },
        },
      },
    ]);
    draft.analytics.posthog.enabled = false;
    expect(changedSectionRows(draft, platformRows)).toEqual([
      { sectionKey: "analytics", payload: {} },
    ]);
  });

  it("writes the consent version only when it is raised", () => {
    const draft = readDraft(platformRows);
    expect(draft.analytics.consentPolicyVersion).toBe(1);
    expect(changedSectionRows(draft, platformRows)).toEqual([]);
    draft.analytics.consentPolicyVersion = 0;
    expect(sectionProblems(draft, "analytics")).toEqual(["consentVersion"]);
    draft.analytics.consentPolicyVersion = 2;
    expect(sectionProblems(draft, "analytics")).toEqual([]);
    expect(changedSectionRows(draft, platformRows)).toEqual([
      {
        sectionKey: "analytics",
        payload: {
          posthog: {
            host: "https://eu.i.posthog.com",
            key: "phc_12345678901234567890",
          },
          consentPolicyVersion: 2,
        },
      },
    ]);
  });
});

describe("notification configuration", () => {
  it("saves and resets the schedule and what a digest covers with the contact section and rejects invalid schedules", () => {
    const draft = savedDraft();
    expect(draft.notifications.digestCovers).toBe("published");
    expect(draft.notifications.pausedSince).toBeNull();
    // A library saved before these settings existed sends digests as written and names nobody.
    expect(draft.notifications).toMatchObject({approval: false, attribution: false});
    draft.notifications = {enabled: true, digestCovers: "added", pausedSince: "2026-10-10T18:00:00.000Z", approval: true, attribution: true, schedule: {frequency: "weekly", weekday: 5, time: "16:30", timezone: "Europe/London"}};
    expect(changedSectionRows(draft, savedRows)).toEqual([{sectionKey: "notifications", payload: draft.notifications}]);
    expect(resetSection(draft, savedRows, "contact").notifications).toEqual(savedDraft().notifications);
    expect(sectionProblems(draft, "contact")).toEqual([]);
    draft.notifications.schedule = {frequency: "monthly", dayOfMonth: 31, time: "23:15", timezone: "Asia/Kolkata"};
    expect(sectionProblems(draft, "contact")).toEqual([]);
    expect(readDraft(changedSectionRows(draft, savedRows)).notifications).toEqual(draft.notifications);
    draft.notifications.schedule.dayOfMonth = 32;
    expect(sectionProblems(draft, "contact")).toContain("notificationSchedule");
    draft.notifications.schedule.dayOfMonth = 31;
    draft.notifications.schedule.timezone = "Not/AZone";
    expect(sectionProblems(draft, "contact")).toContain("notificationSchedule");
    expect(hasProblems(draft)).toBe(true);
  });
});

describe("home page", () => {
  const homeRow = {
    sectionKey: "home",
    payload: {
      intro: "What the library is **for**.",
      curation: {
        text: "Every entry is checked.",
        steps: [
          { type: "arrival", title: "Submitted" },
          { type: "check", editor: "user_ada" },
          { type: "text", title: "Read", text: "We read it.", icon: "AiSearchIcon", figure: { value: "25,000", label: "AI screening judgements" } },
          { type: "search" },
        ],
      },
      team: "A small team.",
      people: [
        {
          id: "user_ada",
          name: "Ada Lovelace",
          photo: "https://img.example.test/ada.png",
          title: "Editor",
        },
      ],
      questions: ["", "What works?"],
      followed: "ABCD1234",
      involvement: { suggestions: false, editors: true },
      extra: { text: "Free to read." },
      headings: { team: "Who we are" },
    },
  } as const;
  const rows = [...savedRows.filter((row) => row.sectionKey !== "home"), homeRow];

  it("writes no home row until the owner answers something", () => {
    const withoutHome = savedRows.filter((row) => row.sectionKey !== "home");
    const draft = readDraft(withoutHome);
    expect(changedSectionRows(draft, withoutHome)).toEqual([]);
    expect(sectionState(draft, withoutHome, "home")).toBe("complete");
    draft.home.intro = "Research on literacy.";
    expect(changedSectionRows(draft, withoutHome).map((row) => row.sectionKey)).toEqual(["home"]);
  });

  it("starts empty with the schema's involvement defaults when there is no row", () => {
    const draft = readDraft(savedRows.filter((row) => row.sectionKey !== "home"));
    expect(draft.home).toEqual({
      intro: "",
      statement: "",
      steps: [],
      team: "",
      people: [],
      questions: ["", "", ""],
      followed: "",
      involvement: { suggestions: true, editors: false },
      extra: { title: "", text: "" },
      headings: { curation: "", team: "", involvement: "" },
    });
    expect(draft.features.homePage).toBe(false);
  });

  it("reads a saved row back to the same payload", () => {
    const draft = readDraft(rows);
    expect(draft.home.steps.map((step) => step.editor)).toEqual(["", "user_ada", "", ""]);
    expect(draft.home.questions).toEqual(["", "What works?", ""]);
    expect(changedSectionRows(draft, rows)).toEqual([]);
    expect(sectionState(draft, rows, "home")).toBe("complete");
    draft.home.intro = "Changed.";
    expect(changedSectionRows(draft, rows)).toEqual([
      { sectionKey: "home", payload: { ...homeRow.payload, intro: "Changed." } },
    ]);
  });

  it("leaves blank values out, keeps inner blank questions and never writes a directory", () => {
    const draft = readDraft(rows);
    draft.home = {
      ...draft.home,
      intro: " ",
      statement: "",
      team: "",
      steps: [{ id: "st_1", type: "check", title: "", text: "", editor: "", icon: "", figureValue: "", figureLabel: "" }],
      people: [{ id: "user_ada", name: "Ada", photo: "", title: "", location: "" }],
      questions: ["", "What works?", " "],
      followed: "",
      extra: { title: " ", text: " " },
      headings: { curation: "", team: "", involvement: "" },
    };
    const [row] = changedSectionRows(draft, rows);
    expect(row).toEqual({
      sectionKey: "home",
      payload: {
        curation: { steps: [{ type: "check" }] },
        people: [{ id: "user_ada", name: "Ada" }],
        questions: ["", "What works?"],
        involvement: { suggestions: false, editors: true },
        headings: {},
      },
    });
    expect(
      validateOwnerSections([{ sectionKey: "home", payload: row!.payload }]).issues,
    ).toEqual([]);
  });

  it("publishes a text step's figure only with both its number and label, and never on a typed step", () => {
    const draft = readDraft(rows);
    const blank = { id: "st_1", title: "Screened", text: "", editor: "", icon: "" };
    draft.home.steps = [
      { ...blank, type: "text", figureValue: "25,000", figureLabel: " " },
      { ...blank, type: "text", figureValue: " 25,000 ", figureLabel: "AI screening judgements" },
      { ...blank, type: "search", figureValue: "25,000", figureLabel: "AI screening judgements" },
    ];
    const [row] = changedSectionRows(draft, rows).filter((entry) => entry.sectionKey === "home");
    const steps = (row?.payload as { curation: { steps: { figure?: unknown }[] } }).curation.steps;
    expect(steps.map((step) => step.figure)).toEqual([undefined, { value: "25,000", label: "AI screening judgements" }, undefined]);
  });

  it("keeps a closing heading without its text and asks for the text", () => {
    const draft = readDraft(rows);
    draft.home.extra = { title: "Reuse", text: " " };
    const [row] = changedSectionRows(draft, rows).filter((entry) => entry.sectionKey === "home");
    expect(row?.payload).toMatchObject({ extra: { title: "Reuse" } });
    expect(
      validateOwnerSections([{ sectionKey: "home", payload: row!.payload }]).issues,
    ).toEqual([
      expect.objectContaining({
        pointer: "/home/extra/text",
        message: "Write the licence and reuse text, or clear its heading.",
      }),
    ]);
  });

  it("owns the home page switch and flags a text step without a name", () => {
    const draft = readDraft(rows);
    draft.features.homePage = true;
    expect(sectionState(draft, rows, "home")).toBe("edited");
    expect(sectionState(draft, rows, "features")).toBe("complete");
    expect(changedSectionRows(draft, rows).map((row) => row.sectionKey)).toEqual(["features"]);
    expect(cardForRow("home")).toBe("home");
    expect(cardForRow("features")).toBe("features");

    draft.home.steps[2]!.title = " ";
    expect(sectionProblems(draft, "home")).toEqual(["homeStepName"]);
    draft.home.intro = "x".repeat(SCHEMA_LIMITS.home.intro + 1);
    expect(sectionProblems(draft, "home")).toEqual(["homeStepName", "homeLimit"]);

    const reset = resetSection(draft, rows, "home");
    expect(reset.features.homePage).toBe(false);
    expect(reset.home.intro).toBe(homeRow.payload.intro);
    expect(sectionProblems(reset, "home")).toEqual([]);
  });
});

describe("readDraft for sources", () => {
  const otherRows = savedRows.filter((row) => row.sectionKey !== "sources");
  it("keeps an OpenAlex source without its search so saving the card reports it", () => {
    const openAlex = {
      key: "openalex-1",
      provider: "openalex",
      enabled: true,
      writebackEnabled: false,
      settings: {
        name: "Early literacy",
        approvedQuery: {
          version: "v1",
          approvedAt: "2026-09-01T00:00:00Z",
          query: { search: "early literacy" },
        },
      },
    };
    const draft = readDraft([
      ...otherRows,
      {
        sectionKey: "sources",
        payload: [
          openAlex,
          { key: "zotero-42", provider: "zotero", groupId: "42", enabled: true },
        ],
      },
    ]);
    draft.sources[1]!.enabled = false;

    const rows = changedSectionRows(draft, [
      ...otherRows,
      { sectionKey: "sources", payload: [openAlex] },
    ]);
    const sources = rows.find((row) => row.sectionKey === "sources");
    expect(sources?.payload).toEqual([
      expect.objectContaining({ key: "openalex-1", provider: "openalex" }),
      expect.objectContaining({ key: "zotero-42", enabled: false }),
    ]);
    expect(
      validateOwnerSections([sources!]).issues.map((issue) => issue.pointer),
    ).toContain("/sources/0/settings/searchUrl");
  });
});
