import {
  aiProviderIssues,
  type ApplyAiProviderKey,
  passThroughAiProviderKey,
} from "./ai";
import schema from "./generated/library-config.schema.json";
import {
  type ValidationIssue,
  validateLibraryConfigStructure,
} from "./generated-validation";
import { type SectionKey, isPlatformSection } from "./section-registry";

export type ManagedEvidenceLibraryConfiguration = {
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
  zoteroTranslationUrl?: string;
  // The platform decides the search embedder. Owners never write it.
  searchEmbedder?: Record<string, unknown> | null;
  // The platform mail service. Owners only choose who receives the emails.
  // Undefined means the mail service is not set up yet.
  mail?: PlatformMailService;
  // The OpenScholar logo and favicon, used when the owner uploads nothing.
  // Undefined means the platform brand is not set up yet.
  brand?: PlatformBrandAssets;
};

export type PlatformBrandAssets = { logoUrl: string; faviconUrl: string };

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
  "Contact and takedown emails need the platform mail service, which is not set up yet. Remove the recipients or ask support.";

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
  const defaults: Record<(typeof BRAND_ASSET_KEYS)[number], string | undefined> = {
    logoDark: brand?.logoUrl,
    favicon: brand?.faviconUrl,
  };
  const filled: Record<string, unknown> = { ...own };
  const missing: (typeof BRAND_ASSET_KEYS)[number][] = [];
  for (const key of BRAND_ASSET_KEYS) {
    if (typeof own[key] === "string" && own[key] !== "") continue;
    if (defaults[key]) filled[key] = defaults[key];
    else missing.push(key);
  }
  return { assets: filled, missing };
}

export function emailWantsPlatformMail(email: unknown): boolean {
  if (!isObject(email)) return false;
  return Boolean(email.contactRecipient) || Boolean(email.takedownRecipient);
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
  // The owner may upload nothing; the OpenScholar logo and favicon fill in.
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
      services: {
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
        publication: {},
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
  const candidate: Record<string, unknown> = {
    ...withDefaults,
    search: {
      ...(isObject(withDefaults.search) ? withDefaults.search : {}),
      embedder: managed.searchEmbedder ?? null,
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
  const aiIssues = aiProviderIssues(
    isObject(candidate.ai) ? candidate.ai.providers : undefined,
    isObject(candidate.features)
      ? candidate.features.ai === true
      : undefined,
  );
  if (aiIssues.length === 0 && isObject(candidate.ai)) {
    // The AI provider key is added here and nowhere earlier, like a source key.
    candidate.ai = {
      ...candidate.ai,
      providers: applyAiProviderKey(
        Array.isArray(candidate.ai.providers)
          ? candidate.ai.providers.filter(isObject)
          : [],
      ),
    };
  }
  const structuralValidation = validateLibraryConfigStructure(candidate);
  // The runtime refuses to start when recipients exist without a mail
  // server. Catch it here so setup stops before anything is created.
  const mailIssues: ValidationIssue[] =
    !managed.mail && emailWantsPlatformMail(email)
      ? [
          {
            pointer: "/email/smtp/host",
            section: "email",
            keyword: "platformMail",
            message: PLATFORM_MAIL_MISSING_MESSAGE,
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
