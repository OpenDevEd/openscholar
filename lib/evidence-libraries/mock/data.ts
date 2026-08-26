/**
 * Fake data for the Evidence Library design prototype.
 * Everything lives in memory. Reload the page to reset it.
 */

import {
  CURRENT_YEAR,
  DRAFT_SECTIONS,
  FEATURE_DEPENDENCIES,
  FEATURE_KEYS,
  type FeatureKey,
  HEX,
  type LibraryConfig,
  type MockFile,
  newId,
  type SectionKey,
} from "./config";

export type { LibraryConfig, SectionKey } from "./config";

export const PLATFORM_DOMAIN = "opendev.space";

export type MockOrganization = {
  id: string;
  name: string;
  initials: string;
  /** CSS background for the avatar tile. */
  color: string;
};

export const MOCK_ORGANIZATIONS: MockOrganization[] = [
  {
    id: "org_1",
    name: "AI in Education",
    initials: "AE",
    color:
      "linear-gradient(135deg, oklch(0.75 0.15 55), oklch(0.62 0.16 52))",
  },
  {
    id: "org_2",
    name: "Open Development & Education",
    initials: "OD",
    color:
      "linear-gradient(135deg, oklch(0.6 0.12 230), oklch(0.5 0.14 260))",
  },
];

export type MockLanguage = { code: string; name: string };

export const MOCK_LANGUAGES: MockLanguage[] = [
  { code: "en-GB", name: "English (UK)" },
  { code: "en-US", name: "English (US)" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "pt", name: "Portuguese" },
  { code: "sw", name: "Swahili" },
  { code: "cn", name: "Chinese" },
];

export type SetupStepKey =
  | "database"
  | "storage"
  | "application"
  | "deployment"
  | "readiness"
  | "active";

export const SETUP_STEP_KEYS: SetupStepKey[] = [
  "database",
  "storage",
  "application",
  "deployment",
  "readiness",
  "active",
];

export type SetupStepStatus = "waiting" | "running" | "done" | "failed";

export type SetupStep = {
  key: SetupStepKey;
  status: SetupStepStatus;
  /** Clock time (HH:MM:SS) when the step finished or failed. */
  at: string;
};

export type ActivationStage = "queued" | "deploying" | "checking" | "live";

export const ACTIVATION_STAGES: ActivationStage[] = [
  "queued",
  "deploying",
  "checking",
  "live",
];

export type LibraryStatus =
  | "draft"
  | "setting_up"
  | "setup_failed"
  | "active"
  | "deleting";


export type MockLibrary = {
  id: string;
  orgId: string;
  name: string;
  shortName: string;
  address: string;
  status: LibraryStatus;
  activeRev: string | null;
  draftRev: string;
  lastActivated: string | null;
  color: string;
  steps: SetupStep[];
  /** When true, the next Deployment tick fails once. */
  failNextDeployment: boolean;
  saved: LibraryConfig;
  draft: LibraryConfig;
  versions: LibraryVersion[];
  paused: boolean;
};

export type { LibraryVersion } from "./config";
import type { LibraryVersion } from "./config";

export type ActivationRun = { stageIndex: number; rev: string };

export const newRevisionId = () =>
  "rev_" + Math.random().toString(36).slice(2, 9);

export const newLibraryId = () =>
  "lib_" + Math.random().toString(36).slice(2, 7);

export const clockTime = () => new Date().toTimeString().slice(0, 8);

export const dateStamp = () => {
  const d = new Date();
  return d.toISOString().slice(0, 10) + " " + d.toTimeString().slice(0, 5);
};

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);

export const initialsOf = (name: string) =>
  (name || "L")
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const addressFor = (shortName: string) =>
  `${shortName || "your-short-name"}.${PLATFORM_DOMAIN}`;


export function makeSteps(doneCount: number, running: boolean): SetupStep[] {
  return SETUP_STEP_KEYS.map((key, i) => ({
    key,
    status:
      i < doneCount ? "done" : i === doneCount && running ? "running" : "waiting",
    at: "",
  }));
}

const LIBRARY_HUES = [20, 160, 300, 230, 80];

export const colorForIndex = (index: number) => {
  const hue = LIBRARY_HUES[index % LIBRARY_HUES.length];
  return `linear-gradient(135deg, oklch(0.7 0.14 ${hue}), oklch(0.55 0.15 ${hue + 25}))`;
};


const svg = (bg: string, text: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" rx="12" fill="${bg}"/><text x="120" y="50" font-family="sans-serif" font-size="28" font-weight="700" text-anchor="middle" fill="#fff">${text}</text></svg>`,
  );

export const mockFile = (name: string, size: number, url: string, text?: string): MockFile => ({
  name,
  size,
  url,
  text,
});

export function makeConfig(
  name: string,
  shortName: string,
  extra: Partial<LibraryConfig["theme"]> = {},
): LibraryConfig {
  return {
    identity: {
      name,
      shortName,
      tagline: "",
      description: "",
      fundingPartners: [],
      shareImage: null,
    },
    theme: {
      layout: "small",
      defaultMode: "system",
      headingFont: "Montserrat",
      bodyFont: "Ubuntu",
      logoDark: null,
      logoLight: null,
      favicon: null,
      accent: "#e68124",
      secondary: "#2b4c7e",
      link: "#c2410c",
      backgroundDark: "#0f0f0f",
      backgroundLight: "#F4F2EE",
      cardDark: "#141414",
      cardLight: "#FFFFFF",
      ...extra,
    },
    institutions: [],
    navigation: { links: [], showSearch: true },
    footer: {
      sections: [],
      social: {},
      funders: [],
      disclaimer: "",
      attribution: "",
      poweredBy: true,
    },
    contact: {
      email: "",
      phone: "",
      address: "",
      contactRecipient: "",
      takedownRecipient: "",
      privacy: { kind: "none" },
      cookie: { kind: "none" },
      terms: { kind: "none" },
    },
    collections: [],
    search: {
      fullText: true,
      tags: true,
      country: true,
      authorCountry: true,
      scopes: ["title_abstract_author_and_keywords", "title", "authors", "everywhere"],
      defaultScope: "title_abstract_author_and_keywords",
      institutionMode: "facet",
      institutionLabel: "Institutions",
      featuredInstitution: "",
      yearsEnabled: true,
      yearMin: 1990,
      yearMax: CURRENT_YEAR,
      collectionsExpanded: true,
    },
    citations: { showUrl: false, ris: true, bibtex: true, atom: false },
    features: {
      ...(Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<FeatureKey, boolean>),
      collections: true,
      authorFilter: true,
      aiProvider: "",
      aiModel: "",
    },
    sources: {
      zotero: [],
      tagRules: {
        hidden: ["hide"],
        internal: ["internal"],
        comingSoon: ["_comingsoon"],
        description: ["_category_description"],
        redirects: ["_redirects"],
        publish: ["_publish", "publishPDF"],
      },
    },
    localization: { locales: ["en-GB"], defaultLocale: "en-GB", detect: false, priority: ["en-GB"] },
    analytics: { provider: "none" },
    team: { visibility: "public", grants: [] },
    domain: { custom: "", status: "none", redirectPlatform: false },
  };
}

function fullConfig(): LibraryConfig {
  const c = makeConfig("AI in Education", "ai-in-education");
  c.identity.tagline = "Evidence on how AI is changing teaching and learning";
  c.identity.description =
    "A curated, searchable library of research on artificial intelligence in education, maintained by the AI in Education programme.";
  c.identity.fundingPartners = [
    { id: "fp_1", name: "Jacobs Foundation" },
    { id: "fp_2", name: "FCDO" },
  ];
  c.identity.shareImage = mockFile("share-card.png", 412_000, svg("#2b4c7e", "AI in Education"));
  c.theme.logoDark = mockFile("logo-dark.svg", 6_200, svg("#0f0f0f", "AIED"));
  c.theme.logoLight = mockFile("logo-light.svg", 6_100, svg("#e68124", "AIED"));
  c.theme.favicon = mockFile("favicon.svg", 1_100, svg("#e68124", "A"));
  c.institutions = [
    { id: "inst_1", name: "EdTech Hub", logo: mockFile("edtech-hub.png", 22_000, svg("#1d9a6c", "ETH")) },
    { id: "inst_2", name: "University of Cambridge", logo: mockFile("cambridge.svg", 9_000, svg("#7c3aed", "UoC")) },
    { id: "inst_3", name: "OpenDevEd", logo: null },
  ];
  c.collections = [
    { id: "col_1", sourceTitle: "Generative AI", title: "", enabled: true, featured: true, count: 312 },
    { id: "col_2", sourceTitle: "Assessment", title: "Assessment & feedback", enabled: true, featured: true, count: 148 },
    { id: "col_3", sourceTitle: "Teacher professional development", title: "", enabled: true, featured: false, count: 96 },
    { id: "col_4", sourceTitle: "Policy", title: "", enabled: true, featured: false, count: 73 },
    { id: "col_5", sourceTitle: "Drafts (internal)", title: "", enabled: false, featured: false, count: 41 },
  ];
  c.navigation.links = [
    { id: "nav_1", label: "Library", target: { kind: "page", page: "library" }, icon: "EvidenceLibrary", newTab: false, visible: true, children: [] },
    {
      id: "nav_2",
      label: "Topics",
      target: { kind: "page", page: "library" },
      icon: "Bookshelf",
      newTab: false,
      visible: true,
      children: [
        { id: "nav_2a", label: "Generative AI", target: { kind: "collection", collectionId: "col_1" }, icon: "", newTab: false, visible: true, children: [] },
        { id: "nav_2b", label: "Assessment", target: { kind: "collection", collectionId: "col_2" }, icon: "", newTab: false, visible: true, children: [] },
      ],
    },
    { id: "nav_3", label: "Map", target: { kind: "page", page: "map" }, icon: "BsMapFill", newTab: false, visible: true, children: [] },
    { id: "nav_4", label: "About", target: { kind: "url", url: "https://aiineducation.org/about" }, icon: "AboutUs", newTab: true, visible: true, children: [] },
    { id: "nav_5", label: "Contact", target: { kind: "page", page: "contact" }, icon: "ContactUs", newTab: false, visible: false, children: [] },
  ];
  c.footer.sections = [
    {
      id: "fs_1",
      title: "Explore",
      links: [
        { id: "fl_1", label: "Library", target: { kind: "page", page: "library" }, icon: "", newTab: false, visible: true, children: [] },
        { id: "fl_2", label: "Map", target: { kind: "page", page: "map" }, icon: "", newTab: false, visible: true, children: [] },
      ],
    },
    {
      id: "fs_2",
      title: "Legal",
      links: [
        { id: "fl_3", label: "Privacy", target: { kind: "page", page: "privacy" }, icon: "", newTab: false, visible: true, children: [] },
        { id: "fl_4", label: "Takedown", target: { kind: "page", page: "takedown" }, icon: "", newTab: false, visible: true, children: [] },
      ],
    },
  ];
  c.footer.social = { github: "https://github.com/OpenDevEd", bluesky: "https://bsky.app/profile/aiined.bsky.social" };
  c.footer.funders = [
    { id: "fu_1", name: "Jacobs Foundation", logo: mockFile("jacobs.svg", 8_000, svg("#334155", "JF")), url: "https://jacobsfoundation.org" },
  ];
  c.footer.disclaimer = "The views expressed here are those of the authors and do not necessarily reflect those of our funders.";
  c.footer.attribution = "© 2026 AI in Education programme";
  c.contact = {
    email: "hello@aiineducation.org",
    phone: "+442071234567",
    address: "Bloomsbury House\n2 Bloomsbury Square\nLondon WC1A 2RL",
    contactRecipient: "hello@aiineducation.org",
    takedownRecipient: "takedown@aiineducation.org",
    privacy: { kind: "file", file: mockFile("privacy.md", 4_800, "", "# Privacy policy\n\nWe store only what the library needs to run.\n\n## What we collect\n\n- Search terms, kept for 30 days\n- Account email, if you sign in\n\n## Contact\n\nprivacy@aiineducation.org") },
    cookie: { kind: "url", url: "https://aiineducation.org/cookies" },
    terms: { kind: "none" },
  };
  c.search.featuredInstitution = "";
  c.features = {
    ...c.features,
    themeSwitcher: true,
    languageSwitcher: true,
    login: true,
    userCollections: true,
    ai: true,
    aiSearch: true,
    relatedResources: true,
    mapPage: true,
    yearsDropdown: true,
    downloads: true,
    aiProvider: "anthropic",
    aiModel: "claude-sonnet-4-6",
  };
  c.sources.zotero = [
    { id: "src_1", label: "AI in Education (main group)", auth: "zotero", groupId: "2405685", apiKey: "", enabled: true, writeback: true, lastSync: "2026-08-26 06:00", records: 1284 },
    { id: "src_2", label: "Partner submissions", auth: "apiKey", groupId: "5133907", apiKey: "P9x4kq…", enabled: true, writeback: false, lastSync: "2026-08-25 22:15", records: 212 },
  ];
  c.localization = { locales: ["en-GB", "fr", "ar"], defaultLocale: "en-GB", detect: true, priority: ["en-GB", "fr", "ar"] };
  c.analytics = { provider: "posthog", host: "https://eu.i.posthog.com", key: "phc_4kd92hs8dksjJ2kd8s7dhsk29sJk" };
  c.team = {
    visibility: "public",
    grants: [
      { id: "g_1", subject: { kind: "person", email: "sara.k@cam.ac.uk", name: "Sara Kim" }, role: "editor", status: "active" },
      { id: "g_2", subject: { kind: "person", email: "j.okafor@edtechhub.org", name: "Jide Okafor" }, role: "editor", status: "active" },
      { id: "g_3", subject: { kind: "organization", orgId: "org_2", name: "Open Development & Education", members: 14 }, role: "viewer", status: "active" },
      { id: "g_4", subject: { kind: "person", email: "reviewer@unesco.org", name: "" }, role: "viewer", status: "invited" },
    ],
  };
  c.domain = { custom: "library.aiineducation.org", status: "verified", redirectPlatform: true };
  return c;
}

function seedLibrary(base: Omit<MockLibrary, "draft" | "address">): MockLibrary {
  return { ...base, address: addressFor(base.shortName), draft: structuredClone(base.saved) };
}

export function seedLibraries(): MockLibrary[] {
  const settingUpSteps = makeSteps(3, true);
  const times = ["14:01:12", "14:01:20", "14:01:31"];
  settingUpSteps.forEach((step, i) => {
    if (i < 3) step.at = times[i];
  });

  return [
    seedLibrary({
      id: "lib_1",
      orgId: "org_1",
      name: "AI in Education",
      shortName: "ai-in-education",
      status: "active",
      activeRev: "rev_8sm1e94",
      draftRev: "rev_9f3ka27",
      lastActivated: "2026-08-19 14:02",
      color: "linear-gradient(135deg, oklch(0.75 0.15 55), oklch(0.62 0.16 52))",
      steps: makeSteps(6, false),
      failNextDeployment: false,
      saved: fullConfig(),
      paused: false,
      versions: [
        { rev: "rev_8sm1e94", at: "2026-08-19 14:02", by: "You", sections: ["theme", "navigation"], status: "live" },
        { rev: "rev_5pq0d11", at: "2026-08-12 09:41", by: "Sara Kim", sections: ["sources", "collections"], status: "previous" },
        { rev: "rev_3ab7z02", at: "2026-08-04 17:20", by: "You", sections: ["features"], status: "failed" },
        { rev: "rev_1kd8s93", at: "2026-07-28 11:05", by: "You", sections: ["identity", "theme", "languages"], status: "previous" },
      ],
    }),
    seedLibrary({
      id: "lib_2",
      orgId: "org_1",
      name: "Health Evidence Hub",
      shortName: "health-evidence-hub",
      status: "setting_up",
      activeRev: null,
      draftRev: "rev_2kd8wq1",
      lastActivated: null,
      color: "linear-gradient(135deg, oklch(0.7 0.14 160), oklch(0.55 0.14 190))",
      steps: settingUpSteps,
      failNextDeployment: true,
      saved: makeConfig("Health Evidence Hub", "health-evidence-hub", { accent: "#1d9a6c", secondary: "#0f3d3e", link: "#047857" }),
      paused: false,
      versions: [],
    }),
    seedLibrary({
      id: "lib_3",
      orgId: "org_1",
      name: "Malaria Review",
      shortName: "malaria-review",
      status: "draft",
      activeRev: null,
      draftRev: "rev_7hh2mz0",
      lastActivated: null,
      color: "linear-gradient(135deg, oklch(0.65 0.16 300), oklch(0.5 0.16 320))",
      steps: makeSteps(0, false),
      failNextDeployment: false,
      saved: makeConfig("Malaria Review", "malaria-review", { accent: "#7c3aed", secondary: "#3b0764", link: "#6d28d9" }),
      paused: false,
      versions: [],
    }),
  ];
}

/** How many of the five build steps are done (the sixth is "active"). */
export const doneStepCount = (library: MockLibrary) =>
  library.steps.slice(0, 5).filter((s) => s.status === "done").length;

export type SectionState = "complete" | "edited" | "attention";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const validUrl = (v: string) => /^https:\/\/\S+$/.test(v);

/** Problems in a draft section. Empty list means the section is fine. */
export function sectionProblems(c: LibraryConfig, key: SectionKey): string[] {
  const out: string[] = [];
  switch (key) {
    case "identity":
      if (!c.identity.name.trim()) out.push("nameMissing");
      break;
    case "theme":
      if (!c.theme.logoDark) out.push("logoMissing");
      if (!c.theme.favicon) out.push("faviconMissing");
      for (const k of ["accent", "secondary", "link"] as const) {
        if (!HEX.test(c.theme[k])) out.push("badColour");
      }
      break;
    case "institutions":
      if (c.institutions.some((i) => !i.name.trim())) out.push("institutionName");
      break;
    case "navigation":
      if (c.navigation.links.some((l) => !l.label.trim() || (l.target.kind === "url" && !validUrl(l.target.url))))
        out.push("navLink");
      break;
    case "footer":
      if (c.footer.sections.some((s) => !s.title.trim())) out.push("footerTitle");
      if (Object.values(c.footer.social).some((u) => u && !validUrl(u))) out.push("socialUrl");
      break;
    case "contact":
      if (!c.contact.takedownRecipient.trim() || !validEmail(c.contact.takedownRecipient)) out.push("takedown");
      if (c.contact.email && !validEmail(c.contact.email)) out.push("email");
      for (const k of ["privacy", "cookie", "terms"] as const) {
        const v = c.contact[k];
        if (v.kind === "url" && !validUrl(v.url)) out.push("legalUrl");
      }
      break;
    case "search":
      if (c.search.scopes.length === 0) out.push("scopes");
      if (!c.search.scopes.includes(c.search.defaultScope)) out.push("defaultScope");
      if (c.search.institutionMode === "facet-with-featured-value" && !c.search.featuredInstitution.trim())
        out.push("featuredInstitution");
      if (c.search.yearMin > c.search.yearMax) out.push("years");
      break;
    case "features":
      for (const [k, deps] of Object.entries(FEATURE_DEPENDENCIES) as [FeatureKey, FeatureKey[]][]) {
        if (c.features[k] && deps.some((d) => !c.features[d])) out.push("dependency");
      }
      if (c.features.ai && (!c.features.aiProvider || !c.features.aiModel)) out.push("aiModel");
      if (c.features.languageSwitcher && c.localization.locales.length < 2) out.push("languageSwitcher");
      if (c.features.downloads && !c.citations.ris && !c.citations.bibtex) out.push("downloads");
      if (c.features.atomFeed && !c.citations.atom) out.push("atom");
      break;
    case "sources":
      if (c.sources.zotero.some((s) => !s.groupId.trim() || (s.auth === "apiKey" && !s.apiKey.trim())))
        out.push("source");
      if (c.sources.tagRules.publish.length === 0) out.push("publishTag");
      break;
    case "languages":
      if (c.localization.locales.length === 0 || !c.localization.locales.includes(c.localization.defaultLocale))
        out.push("locale");
      break;
    case "analytics":
      if (c.analytics.provider === "posthog" && (!c.analytics.host || !/^phc_/.test(c.analytics.key)))
        out.push("posthog");
      if (c.analytics.provider === "google" && !/^G-[A-Z0-9]{4,20}$/.test(c.analytics.measurementId))
        out.push("google");
      break;
    case "domain":
      if (c.domain.custom && c.domain.status === "failed") out.push("dns");
      break;
    default:
      break;
  }
  return out;
}

const SECTION_SLICE: Record<Exclude<SectionKey, "versions" | "danger">, (c: LibraryConfig) => unknown> = {
  identity: (c) => c.identity,
  theme: (c) => c.theme,
  institutions: (c) => c.institutions,
  navigation: (c) => c.navigation,
  footer: (c) => c.footer,
  contact: (c) => c.contact,
  collections: (c) => c.collections,
  search: (c) => c.search,
  citations: (c) => c.citations,
  features: (c) => c.features,
  sources: (c) => c.sources,
  languages: (c) => c.localization,
  analytics: (c) => c.analytics,
  team: (c) => c.team,
  domain: (c) => c.domain,
};

export const sectionChanged = (library: MockLibrary, key: SectionKey) =>
  key in SECTION_SLICE &&
  !same(
    SECTION_SLICE[key as keyof typeof SECTION_SLICE](library.draft),
    SECTION_SLICE[key as keyof typeof SECTION_SLICE](library.saved),
  );

export function sectionState(library: MockLibrary, key: SectionKey): SectionState {
  if (sectionProblems(library.draft, key).length > 0) return "attention";
  return sectionChanged(library, key) ? "edited" : "complete";
}

/** Copy one section of `saved` back into `draft`. */
export function resetSection(library: MockLibrary, key: SectionKey): LibraryConfig {
  const draft = structuredClone(library.draft);
  const saved = library.saved;
  switch (key) {
    case "languages":
      draft.localization = structuredClone(saved.localization);
      break;
    case "versions":
    case "danger":
      break;
    default:
      (draft as Record<string, unknown>)[key] = structuredClone(
        (saved as Record<string, unknown>)[key],
      );
  }
  return draft;
}

export const isDirty = (library: MockLibrary) => !same(library.draft, library.saved);

export const hasErrors = (library: MockLibrary) =>
  DRAFT_SECTIONS.some((k) => sectionState(library, k) === "attention");

export const changedSections = (library: MockLibrary) =>
  DRAFT_SECTIONS.filter((k) => sectionChanged(library, k));

export { newId };
