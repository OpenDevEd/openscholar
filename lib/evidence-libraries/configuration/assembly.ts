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
};

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
}: {
  sections: OwnerSections;
  managed: ManagedEvidenceLibraryConfiguration;
  now?: Date;
  applySourceCredentials?: ApplySourceCredentials;
}): AssembledEvidenceLibraryConfiguration {
  const owner = Object.fromEntries(
    Object.entries(sections).filter(
      ([key, payload]) =>
        payload !== undefined && !isPlatformSection(key as SectionKey),
    ),
  );
  const withDefaults = applyGeneratedDefaults(
    schema as JsonSchemaNode,
    {
      schemaVersion: 1,
      revision: managed.revision,
      updatedAt: managed.updatedAt,
      ...owner,
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
  const structuralValidation = validateLibraryConfigStructure(candidate);
  const issues = uniqueIssues(structuralValidation.issues);
  if (issues.length > 0) throw new ConfigurationAssemblyError(issues);
  return candidate as AssembledEvidenceLibraryConfiguration;
}
