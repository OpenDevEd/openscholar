import schema from "./generated/library-config.schema.json";
import type { EssentialConfigurationSections } from "./essential-configuration";
import {
  type ValidationIssue,
  validateLibraryConfigStructure,
} from "./validation";

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
  storageDocumentsBucket: string;
  storageImagesBucket: string;
  storageMaxPdfBytes: number;
  zoteroTranslationUrl?: string;
};

export type AssembledEvidenceLibraryConfiguration = Record<string, unknown> & {
  identity: EssentialConfigurationSections["identity"];
  localization: EssentialConfigurationSections["localization"];
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
    value === undefined && Object.hasOwn(node, "default")
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

export function assembleEvidenceLibraryConfiguration({
  sections,
  managed,
  now = new Date(),
}: {
  sections: EssentialConfigurationSections;
  managed: ManagedEvidenceLibraryConfiguration;
  now?: Date;
}): AssembledEvidenceLibraryConfiguration {
  const candidate = applyGeneratedDefaults(
    schema as JsonSchemaNode,
    {
      schemaVersion: 1,
      revision: managed.revision,
      updatedAt: managed.updatedAt,
      identity: sections.identity,
      theme: sections.theme,
      localization: sections.localization,
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
          privateBucket: managed.storageDocumentsBucket,
          publicBucket: managed.storageImagesBucket,
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
  );
  const structuralValidation = validateLibraryConfigStructure(candidate);
  const issues = uniqueIssues(structuralValidation.issues);
  if (issues.length > 0) throw new ConfigurationAssemblyError(issues);
  return candidate as AssembledEvidenceLibraryConfiguration;
}
