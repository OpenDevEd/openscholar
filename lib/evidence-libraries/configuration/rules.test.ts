import { describe, expect, it } from "vitest";
import {
  cardForRow,
  changedSectionRows,
  isDirty,
  hasProblems,
  readDraft,
  resetSection,
  sectionProblems,
  sectionState,
  staleUploads,
  SCHEMA_LIMITS,
  THEME_DEFAULTS,
  type ConfigurationDraft,
} from "./rules";

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

const savedRows = [
  ...brandRows,
  { sectionKey: "navigation", payload: { links: [] } },
  { sectionKey: "features", payload: {} },
  { sectionKey: "footer", payload: {} },
  { sectionKey: "contact", payload: {} },
  { sectionKey: "email", payload: { takedownRecipient: "takedown@example.org" } },
  { sectionKey: "legal", payload: {} },
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

describe("staleUploads", () => {
  it("lists saved files the draft no longer points at", () => {
    const draft = savedDraft();
    draft.identity.assets.logoDark = "https://assets.example.test/logo-dark-2.svg";
    const rows = savedRows.map((row) =>
      row.sectionKey === "institutions"
        ? {
            sectionKey: "institutions",
            payload: [
              { id: "inst_1", name: "EdTech Hub", logoUrl: "https://assets.example.test/edtech-hub.png" },
            ],
          }
        : row,
    );
    draft.institutions = [];
    expect(staleUploads(draft, rows)).toEqual([
      "https://assets.example.test/logo-dark.svg",
      "https://assets.example.test/edtech-hub.png",
    ]);
  });

  it("keeps a file that is still used somewhere in the draft", () => {
    const draft = savedDraft();
    draft.identity.assets.logoLight = draft.identity.assets.logoDark;
    draft.identity.assets.logoDark = "https://assets.example.test/logo-dark-2.svg";
    expect(staleUploads(draft, savedRows)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Plan 06: navigation, footer, contact & legal                         */
/* ------------------------------------------------------------------ */

const contentRows = [
  ...brandRows,
  {
    sectionKey: "navigation",
    payload: {
      links: [
        {
          id: "nav_1",
          label: "Library",
          href: "/lib",
          icon: "EvidenceLibrary",
          target: "self",
          visible: true,
          children: [
            { id: "nav_1a", label: "AI", href: "/lib?collections=COL1", target: "self", visible: true },
          ],
        },
      ],
    },
  },
  { sectionKey: "features", payload: { navbarSearch: false, collections: true } },
  {
    sectionKey: "footer",
    payload: {
      sections: [{ id: "fs_1", title: "Explore", links: [{ id: "fl_1", label: "Map", href: "/map" }] }],
      socialLinks: [{ provider: "github", href: "https://github.com/OpenDevEd" }],
      funders: [{ id: "fu_1", name: "Jacobs Foundation", logoUrl: "https://assets.example.test/jacobs.svg" }],
      disclaimer: "Views are the authors' own.",
      attribution: "",
      poweredBy: true,
    },
  },
  { sectionKey: "contact", payload: { email: "hello@example.org", phone: "+442071234567" } },
  { sectionKey: "email", payload: { takedownRecipient: "takedown@example.org" } },
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
    expect(draft.navigation.links[0]?.target).toEqual({ kind: "page", page: "library" });
    expect(draft.navigation.links[0]?.children[0]?.target).toEqual({
      kind: "collection",
      collectionId: "COL1",
    });
    expect(draft.features.navbarSearch).toBe(false);
    expect(draft.features.collections).toBe(true);
    expect(draft.features.downloads).toBe(false);
    expect(draft.footer.social).toEqual({ github: "https://github.com/OpenDevEd" });
    expect(draft.footer.funders[0]).toEqual({
      id: "fu_1",
      name: "Jacobs Foundation",
      logoUrl: "https://assets.example.test/jacobs.svg",
      href: "",
    });
    expect(draft.contact.phone).toBe("+442071234567");
    expect(draft.email.takedownRecipient).toBe("takedown@example.org");
    expect(draft.legal.privacy).toEqual({ kind: "text", text: "# Privacy\n\nWe keep little." });
    expect(draft.legal.cookie).toEqual({ kind: "url", url: "https://example.org/cookies" });
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
    draft.navigation.links[0]!.children[0]!.target = { kind: "collection", collectionId: "" };
    draft.navigation.links.push({
      id: "nav_2",
      label: "About",
      target: { kind: "url", url: "about" },
      icon: "",
      newTab: true,
      visible: true,
      children: [],
    });
    expect(sectionProblems(draft, "navigation")).toEqual(["linkLabel", "linkCollection", "linkUrl"]);
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

  it("requires a takedown recipient and checks the other contact values", () => {
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
    expect(rows[0]?.payload).toMatchObject({ navbarSearch: true, collections: true, downloads: false });
    expect(sectionState(draft, contentRows, "navigation")).toBe("edited");
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
              icon: "EvidenceLibrary",
              target: "self",
              visible: true,
              children: [
                { id: "nav_1a", label: "AI", href: "/lib?collections=COL1", target: "self", visible: true },
                { id: "nav_1b", label: "About", href: "https://example.org/about", target: "blank", visible: true },
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
            { id: "fs_1", title: "Explore", links: [{ id: "fl_1", label: "Map", href: "/map", target: "self", visible: true }] },
          ],
          socialLinks: [{ provider: "bluesky", href: "https://bsky.app/profile/opendeved" }],
          funders: [{ id: "fu_1", name: "Jacobs Foundation", href: "https://jacobsfoundation.org" }],
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
        payload: { contactRecipient: "team@example.org", takedownRecipient: "takedown@example.org" },
      },
      {
        sectionKey: "legal",
        payload: { privacyPolicy: "https://example.org/privacy", termsMarkdown: "# Terms" },
      },
    ]);
  });

  it("resets the navigation card including the navbar search switch", () => {
    const draft = readDraft(contentRows);
    draft.features.navbarSearch = true;
    draft.features.downloads = true;
    draft.navigation.links = [];
    const reset = resetSection(draft, contentRows, "navigation");
    expect(reset.navigation.links).toHaveLength(1);
    expect(reset.features.navbarSearch).toBe(false);
    expect(reset.features.downloads).toBe(true);
  });

  it("counts funder logos as uploads", () => {
    const draft = readDraft(contentRows);
    draft.footer.funders = [];
    expect(staleUploads(draft, contentRows)).toEqual(["https://assets.example.test/jacobs.svg"]);
  });

  it("points an email issue at the contact card", () => {
    expect(cardForRow("email")).toBe("contact");
    expect(cardForRow("legal")).toBe("contact");
    expect(cardForRow("features")).toBe("navigation");
    expect(cardForRow("services")).toBeNull();
  });
});
