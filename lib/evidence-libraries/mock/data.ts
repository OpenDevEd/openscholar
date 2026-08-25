/**
 * Fake data for the Evidence Library design prototype.
 * Everything lives in memory. Reload the page to reset it.
 */

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
  { code: "fr", name: "French" },
  { code: "am", name: "Amharic" },
  { code: "ar", name: "Arabic" },
  { code: "es", name: "Spanish" },
  { code: "pt", name: "Portuguese" },
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

export type LibraryConfig = {
  name: string;
  shortName: string;
  logoDark: string;
  logoLight: string;
  favicon: string;
  accent: string;
  secondary: string;
  languages: string[];
  defaultLanguage: string;
};

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
};

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

export function makeConfig(
  name: string,
  shortName: string,
  extra: Partial<LibraryConfig> = {},
): LibraryConfig {
  return {
    name,
    shortName,
    logoDark: `https://${shortName}.${PLATFORM_DOMAIN}/brand/logo-dark.svg`,
    logoLight: "",
    favicon: `https://${shortName}.${PLATFORM_DOMAIN}/favicon.ico`,
    accent: "#e68124",
    secondary: "#1f4e79",
    languages: ["en-GB"],
    defaultLanguage: "en-GB",
    ...extra,
  };
}

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

function seedLibrary(
  base: Omit<MockLibrary, "draft" | "address">,
): MockLibrary {
  return {
    ...base,
    address: addressFor(base.shortName),
    draft: structuredClone(base.saved),
  };
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
      color:
        "linear-gradient(135deg, oklch(0.75 0.15 55), oklch(0.62 0.16 52))",
      steps: makeSteps(6, false),
      failNextDeployment: false,
      saved: makeConfig("AI in Education", "ai-in-education", {
        logoLight: "https://ai-in-education.opendev.space/brand/logo-light.svg",
        languages: ["en-GB", "fr", "ar"],
        accent: "#e68124",
        secondary: "#2b4c7e",
      }),
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
      color:
        "linear-gradient(135deg, oklch(0.7 0.14 160), oklch(0.55 0.14 190))",
      steps: settingUpSteps,
      failNextDeployment: true,
      saved: makeConfig("Health Evidence Hub", "health-evidence-hub", {
        accent: "#1d9a6c",
        secondary: "#0f3d3e",
        languages: ["en-GB", "pt"],
      }),
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
      color:
        "linear-gradient(135deg, oklch(0.65 0.16 300), oklch(0.5 0.16 320))",
      steps: makeSteps(0, false),
      failNextDeployment: false,
      saved: makeConfig("Malaria Review", "malaria-review", {
        accent: "#7c3aed",
        secondary: "#3b0764",
      }),
    }),
  ];
}

/** How many of the five build steps are done (the sixth is "active"). */
export const doneStepCount = (library: MockLibrary) =>
  library.steps.slice(0, 5).filter((s) => s.status === "done").length;

export type SectionKey = "identity" | "branding" | "languages";
export type SectionState = "complete" | "edited" | "attention";

export const EDITABLE_SECTIONS: SectionKey[] = [
  "identity",
  "branding",
  "languages",
];

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function sectionState(
  library: MockLibrary,
  key: SectionKey,
): SectionState {
  const d = library.draft;
  const s = library.saved;
  const changed = (fields: (keyof LibraryConfig)[]) =>
    fields.some((f) => !same(d[f], s[f]));

  if (key === "identity") {
    if (!d.name.trim()) return "attention";
    return changed(["name", "shortName"]) ? "edited" : "complete";
  }
  if (key === "branding") {
    if (!d.logoDark.trim() || !d.favicon.trim()) return "attention";
    return changed(["logoDark", "logoLight", "favicon", "accent", "secondary"])
      ? "edited"
      : "complete";
  }
  if (d.languages.length === 0 || !d.languages.includes(d.defaultLanguage)) {
    return "attention";
  }
  return changed(["languages", "defaultLanguage"]) ? "edited" : "complete";
}

export const isDirty = (library: MockLibrary) =>
  !same(library.draft, library.saved);

export const hasErrors = (library: MockLibrary) =>
  EDITABLE_SECTIONS.some((k) => sectionState(library, k) === "attention");
