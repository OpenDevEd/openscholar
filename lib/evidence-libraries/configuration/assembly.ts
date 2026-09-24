import { publicName, publicPhoto } from "./home-people";
import {
  aiProviderIssues,
  type ApplyAiProviderKey,
  passThroughAiProviderKey,
  PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE,
  platformSearchEmbedder,
} from "./ai";
import schema from "./generated/library-config.schema.json";
import {
  type ValidationIssue,
  validateLibraryConfigStructure,
} from "./generated-validation";
import { type SectionKey, isPlatformSection } from "./section-registry";

export type ManagedEvidenceLibraryConfiguration = {
  publication?: Record<string, unknown>;
  revision: string;
  updatedAt: string;
  libraryId: string;
  convexSiteUrl: string;
  loginPageUrl: string;
  machineCredential: string;
  authenticationSecret: string;
  databaseUrl: string;
  searchHost: string;
  searchKey: string;
  searchIndex: string;
  storageUrl: string;
  storageServiceRoleKey: string;
  storagePrivateBucket: string;
  storagePublicBucket: string;
  storageMaxPdfBytes: number;
  // OpenScholar model ids from the OpenRouter-backed models table.
  allowedAiModels: readonly string[];
  aiModelMetadata: Record<string, { name: string; company: string }>;
  aiModelCatalogReady: boolean;
  zoteroTranslationUrl?: string;
  // The platform pays for meaning-based search. Assembly builds the embedder
  // from this key; owners never see it. Undefined means no key is set up.
  embeddingApiKey?: string;
  // The platform mail service. Owners only choose who receives the emails.
  // Undefined means the mail service is not set up yet.
  mail?: PlatformMailService;
  // The OpenScholar logo and browser icon set, used when the owner uploads nothing.
  // Undefined means the platform brand is not set up yet.
  brand?: PlatformBrandAssets;
  // Everyone with a role on the library. The home page names approvers and
  // shows people from this list.
  team: readonly TeamMember[];
};

export type TeamMember = { id: string; name: string; photo?: string };

export type PlatformBrandAssets = {
  logoUrl: string;
  faviconUrl: string;
  iconUrls: readonly string[];
};

export const PLATFORM_BRAND_MISSING_MESSAGE =
  "The library has no logo or favicon and the OpenScholar defaults are not set up yet. Upload one or ask support.";

export type PlatformMailService = {
  host: string;
  port: number;
  security: "tls" | "starttls" | "none";
  from: string;
  username?: string;
  password?: string;
};

export const PLATFORM_MAIL_MISSING_MESSAGE =
  "Email delivery needs the platform mail service, which is not set up yet. Disable email updates and remove recipients, or ask support.";

const BRAND_ASSET_KEYS = ["logoDark", "favicon"] as const;

/**
 * Puts the platform logo and favicon into `identity.assets` where the owner
 * left them empty. Returns the assets and the keys that stayed empty because
 * the platform brand is not set up.
 */
export function fillBrandAssets(
  assets: unknown,
  brand: PlatformBrandAssets | undefined,
): { assets: Record<string, unknown>; missing: (typeof BRAND_ASSET_KEYS)[number][] } {
  const own = isObject(assets) ? assets : {};
  const hasOwnerFavicon = typeof own.favicon === "string" && own.favicon !== "";
  const ownLogoLight =
    typeof own.logoLight === "string" && own.logoLight !== ""
      ? own.logoLight
      : undefined;
  const defaults: Record<(typeof BRAND_ASSET_KEYS)[number], string | undefined> = {
    // The light logo is the owner's main one; dark mode uses it until a dark
    // logo is uploaded.
    logoDark: ownLogoLight ?? brand?.logoUrl,
    favicon: brand?.faviconUrl,
  };
  const filled: Record<string, unknown> = { ...own };
  const missing: (typeof BRAND_ASSET_KEYS)[number][] = [];
  for (const key of BRAND_ASSET_KEYS) {
    if (typeof own[key] === "string" && own[key] !== "") continue;
    if (defaults[key]) filled[key] = defaults[key];
    else missing.push(key);
  }
  if (
    !hasOwnerFavicon &&
    (!Array.isArray(own.icons) || own.icons.length === 0) &&
    brand
  ) {
    filled.icons = [...brand.iconUrls];
  }
  return { assets: filled, missing };
}

export function emailWantsPlatformMail(email: unknown): boolean {
  if (!isObject(email)) return false;
  return Boolean(email.contactRecipient) || Boolean(email.takedownRecipient);
}

// The runtime lists at most 500 people in the directory.
const HOME_DIRECTORY_MAX = 500;

/** A team member as the home page shows them, or nothing without a usable name; no usable photo means no key. */
function personFields(member: TeamMember) {
  const name = publicName(member.name);
  if (!name) return undefined;
  const photo = publicPhoto(member.photo);
  return photo ? { name, photo } : { name };
}

/**
 * The owner's home row with the team filled in: the directory the runtime
 * names approvers from, people refreshed from their accounts, and nobody who
 * has left the team, as a person shown or as a step's editor.
 */
function fillHomeTeam(
  home: Record<string, unknown>,
  team: readonly TeamMember[],
): Record<string, unknown> {
  // Only people the page can name: a member without a usable name is on neither list.
  const shown = team.flatMap((member) => {
    const fields = personFields(member);
    return fields ? [{ id: member.id, ...fields }] : [];
  });
  const members = new Map(shown.map((member) => [member.id, member]));
  // The steps' editors go first, so a capped directory still names them.
  const editors = new Set(
    isObject(home.curation) && Array.isArray(home.curation.steps)
      ? home.curation.steps.flatMap((step) =>
          isObject(step) && typeof step.editor === "string" ? [step.editor] : [],
        )
      : [],
  );
  const filled: Record<string, unknown> = {
    ...home,
    directory: [
      ...shown.filter((member) => editors.has(member.id)),
      ...shown.filter((member) => !editors.has(member.id)),
    ].slice(0, HOME_DIRECTORY_MAX),
  };
  if (Array.isArray(home.people)) {
    filled.people = home.people.flatMap((person) => {
      const member = isObject(person) && members.get(person.id as string);
      if (!member) return [];
      const { photo: _stale, ...rest } = person;
      const { id: _id, ...fields } = member;
      return [{ ...rest, ...fields }];
    });
  }
  if (isObject(home.curation) && Array.isArray(home.curation.steps)) {
    filled.curation = {
      ...home.curation,
      steps: home.curation.steps.map((step) => {
        if (!isObject(step) || step.editor === undefined) return step;
        if (members.has(step.editor as string)) return step;
        const { editor: _gone, ...rest } = step;
        return rest;
      }),
    };
  }
  return filled;
}

export type OwnerSections = Partial<Record<SectionKey, unknown>>;

export type SourceEntry = Record<string, unknown>;

// Plan 07 fills this: each Zotero source receives the key of the owner who
// connected its group. Plan 02 leaves the hook as a pass-through.
export type ApplySourceCredentials = (
  sources: readonly SourceEntry[],
) => SourceEntry[];

export const passThroughSourceCredentials: ApplySourceCredentials = (sources) =>
  sources.map((source) => ({ ...source }));

export type AssembledEvidenceLibraryConfiguration = Record<string, unknown> & {
  services: {
    database: { url: string };
    search: { host: string; key: string; index: string };
    storage: {
      url: string;
      serviceRoleKey: string;
      privateBucket: string;
      publicBucket: string;
      maxPdfBytes: number;
    };
  };
  authentication: {
    openScholar: {
      convexSiteUrl: string;
      libraryId: string;
      loginPageUrl: string;
      machineCredential: string;
    };
    secret: string;
  };
};

export class ConfigurationAssemblyError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super("Evidence Library configuration is invalid");
    this.name = "ConfigurationAssemblyError";
    this.issues = issues;
  }
}

type JsonSchemaNode = {
  default?: unknown;
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  type?: string;
  "x-dynamicDefault"?: string;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function applyGeneratedDefaults(
  node: JsonSchemaNode,
  value: unknown,
  now: Date,
): unknown {
  const source =
    value === undefined && Object.prototype.hasOwnProperty.call(node, "default")
      ? cloneJson(node.default)
      : value === undefined && node["x-dynamicDefault"] === "currentUtcYear"
        ? now.getUTCFullYear()
        : value;

  if (Array.isArray(source)) {
    return node.items
      ? source.map((item) => applyGeneratedDefaults(node.items!, item, now))
      : source;
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return source;
  }

  const result: Record<string, unknown> = {
    ...(source as Record<string, unknown>),
  };
  for (const [key, property] of Object.entries(node.properties ?? {})) {
    const resolved = applyGeneratedDefaults(property, result[key], now);
    if (resolved !== undefined) result[key] = resolved;
  }
  return result;
}

function uniqueIssues(issues: ValidationIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.pointer}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Merge order: schema defaults, then every owner section, then platform
// values, then per-source credentials. The full validator decides at the end.
export function assembleEvidenceLibraryConfiguration({
  sections,
  managed,
  now = new Date(),
  applySourceCredentials = passThroughSourceCredentials,
  applyAiProviderKey = passThroughAiProviderKey,
}: {
  sections: OwnerSections;
  managed: ManagedEvidenceLibraryConfiguration;
  now?: Date;
  applySourceCredentials?: ApplySourceCredentials;
  applyAiProviderKey?: ApplyAiProviderKey;
}): AssembledEvidenceLibraryConfiguration {
  const owner = Object.fromEntries(
    Object.entries(sections).filter(
      ([key, payload]) =>
        payload !== undefined && !isPlatformSection(key as SectionKey),
    ),
  );
  // The owner row keeps recipients only. The mail server comes from the
  // platform, like every other service.
  const { smtp: _ownerSmtp, ...ownerEmail } = isObject(owner.email)
    ? owner.email
    : {};
  const email = managed.mail
    ? { ...ownerEmail, smtp: managed.mail }
    : ownerEmail;
  // The owner may upload nothing; the OpenScholar logo and browser icons fill in.
  const ownerIdentity = isObject(owner.identity) ? owner.identity : {};
  const brand = fillBrandAssets(ownerIdentity.assets, managed.brand);
  const identity = { ...ownerIdentity, assets: brand.assets };
  const withDefaults = applyGeneratedDefaults(
    schema as JsonSchemaNode,
    {
      schemaVersion: 1,
      revision: managed.revision,
      updatedAt: managed.updatedAt,
      ...owner,
      identity,
      email,
      // The home row is the owner's; who is on the team is the platform's.
      ...(isObject(owner.home)
        ? { home: fillHomeTeam(owner.home, managed.team) }
        : {}),
      services: {
        // Every managed runtime has this private Compose service.
        redis: { url: "redis://evidence-library-redis:6379" },
        database: { url: managed.databaseUrl },
        search: {
          host: managed.searchHost,
          key: managed.searchKey,
          index: managed.searchIndex,
        },
        storage: {
          url: managed.storageUrl,
          serviceRoleKey: managed.storageServiceRoleKey,
          privateBucket: managed.storagePrivateBucket,
          publicBucket: managed.storagePublicBucket,
          maxPdfBytes: managed.storageMaxPdfBytes,
        },
        zotero: managed.zoteroTranslationUrl
          ? { translationUrl: managed.zoteroTranslationUrl }
          : {},
        publication: managed.publication ?? {},
      },
      authentication: {
        google: {},
        openScholar: {
          convexSiteUrl: managed.convexSiteUrl,
          libraryId: managed.libraryId,
          loginPageUrl: managed.loginPageUrl,
          machineCredential: managed.machineCredential,
        },
        secret: managed.authenticationSecret,
      },
    },
    now,
  ) as Record<string, unknown>;
  // AI answers decide both halves of the AI offer: the assistant and search
  // by meaning. The runtime refuses AI search without an embedder, so the
  // two are written together or not at all. Deep research is a separate
  // decision and stays off whatever a saved row says.
  const features = isObject(withDefaults.features) ? withDefaults.features : {};
  const aiOn = features.ai === true;
  const candidate: Record<string, unknown> = {
    ...withDefaults,
    features: { ...features, aiSearch: aiOn, deepResearch: false },
    search: {
      ...(isObject(withDefaults.search) ? withDefaults.search : {}),
      embedder:
        aiOn && managed.embeddingApiKey
          ? platformSearchEmbedder(managed.embeddingApiKey)
          : null,
    },
  };
  if (Array.isArray(candidate.sources)) {
    candidate.sources = applySourceCredentials(
      candidate.sources.filter(isObject),
    );
  }
  // Exactly one OpenRouter entry, agreeing with the AI answers switch, with a
  // model the runtime approves. Checked before the key is added, so a wrong
  // entry never receives one.
  const aiRowSaved = owner.ai !== undefined;
  const aiIssues = aiProviderIssues(
    isObject(candidate.ai) ? candidate.ai.providers : undefined,
    isObject(candidate.features)
      ? candidate.features.ai === true
      : undefined,
    aiRowSaved,
    new Set(managed.allowedAiModels),
    managed.aiModelCatalogReady,
  );
  if (aiIssues.length === 0 && aiRowSaved && isObject(candidate.ai)) {
    // The AI provider key is added here and nowhere earlier, like a source key.
    candidate.ai = {
      ...candidate.ai,
      providers: applyAiProviderKey(
        Array.isArray(candidate.ai.providers)
          ? candidate.ai.providers.filter(isObject)
          : [],
      ).map((provider) => ({
        ...provider,
        modelMetadata: Object.fromEntries(
          Object.entries(managed.aiModelMetadata).filter(
            ([id]) => Array.isArray(provider.models) && provider.models.includes(id),
          ),
        ),
      })),
    };
  }
  const structuralValidation = validateLibraryConfigStructure(candidate);
  // The runtime refuses to start when recipients exist without a mail
  // server. Catch it here so setup stops before anything is created.
  const mailIssues: ValidationIssue[] =
    !managed.mail && (emailWantsPlatformMail(email) || (isObject(owner.notifications) && owner.notifications.enabled === true))
      ? [
          {
            pointer: "/email/smtp/host",
            section: "email",
            keyword: "platformMail",
            message: PLATFORM_MAIL_MISSING_MESSAGE,
          },
        ]
      : [];
  // Same rule as the mail service: stop here, before anything is created,
  // rather than let the runtime fail to start.
  const embedderIssues: ValidationIssue[] =
    aiOn && !managed.embeddingApiKey
      ? [
          {
            pointer: "/search/embedder",
            section: "ai",
            keyword: "platformEmbedder",
            message: PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE,
          },
        ]
      : [];
  const brandIssues: ValidationIssue[] = brand.missing.map((key) => ({
    pointer: `/identity/assets/${key}`,
    section: "identity",
    keyword: "platformBrand",
    message: PLATFORM_BRAND_MISSING_MESSAGE,
  }));
  const issues = uniqueIssues([
    ...aiIssues,
    ...embedderIssues,
    ...brandIssues,
    ...structuralValidation.issues.filter(
      (issue) =>
        !brandIssues.some((brandIssue) => brandIssue.pointer === issue.pointer),
    ),
    ...mailIssues,
  ]);
  if (issues.length > 0) throw new ConfigurationAssemblyError(issues);
  return candidate as AssembledEvidenceLibraryConfiguration;
}
