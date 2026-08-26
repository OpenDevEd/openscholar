import catalogs from "./generated/library-config.catalogs.json";
import schema from "./generated/library-config.schema.json";
import {
  escapeJsonPointerToken,
  jsonPointerPatternMatches,
  unescapeJsonPointerToken,
} from "./json-pointer";

export const ENVELOPE_FIELDS = [
  "schemaVersion",
  "revision",
  "updatedAt",
] as const;

export type FieldAuthority =
  | "controlPlaneGenerated"
  | "ownerEdited"
  | "catalogDerived"
  | "platformProvisioned"
  | "credentialLifecycle";

type SectionDefinition = {
  key: string;
  pointer: `/${string}`;
  label: string;
  description: string;
  authority: Exclude<
    FieldAuthority,
    "controlPlaneGenerated" | "credentialLifecycle"
  >;
};

export const SECTION_REGISTRY = [
  {
    key: "identity",
    pointer: "/identity",
    label: "Identity",
    description: "Library name, URL, and visual identity.",
    authority: "ownerEdited",
  },
  {
    key: "institutions",
    pointer: "/institutions",
    label: "Institutions",
    description: "Institution labels and presentation.",
    authority: "ownerEdited",
  },
  {
    key: "theme",
    pointer: "/theme",
    label: "Theme",
    description: "Layout, typography, colour, and logo treatment.",
    authority: "ownerEdited",
  },
  {
    key: "navigation",
    pointer: "/navigation",
    label: "Navigation",
    description: "Primary navigation and link behaviour.",
    authority: "ownerEdited",
  },
  {
    key: "footer",
    pointer: "/footer",
    label: "Footer",
    description: "Footer navigation, social links, and credits.",
    authority: "ownerEdited",
  },
  {
    key: "contact",
    pointer: "/contact",
    label: "Contact",
    description: "Public contact channels.",
    authority: "ownerEdited",
  },
  {
    key: "legal",
    pointer: "/legal",
    label: "Legal",
    description: "Legal links and policy presentation.",
    authority: "ownerEdited",
  },
  {
    key: "localization",
    pointer: "/localization",
    label: "Localization",
    description: "Default locale and available translations.",
    authority: "ownerEdited",
  },
  {
    key: "search",
    pointer: "/search",
    label: "Search",
    description: "Search defaults and presentation.",
    authority: "ownerEdited",
  },
  {
    key: "filters",
    pointer: "/filters",
    label: "Filters",
    description: "Discovery filter presentation.",
    authority: "ownerEdited",
  },
  {
    key: "content",
    pointer: "/content",
    label: "Content",
    description: "Editorial content and labels.",
    authority: "ownerEdited",
  },
  {
    key: "citations",
    pointer: "/citations",
    label: "Citations",
    description: "Citation display and export choices.",
    authority: "ownerEdited",
  },
  {
    key: "features",
    pointer: "/features",
    label: "Features",
    description: "Catalog-backed runtime capabilities.",
    authority: "catalogDerived",
  },
  {
    key: "collections",
    pointer: "/collections",
    label: "Collections",
    description: "Collection presentation and ordering.",
    authority: "ownerEdited",
  },
  {
    key: "gapMaps",
    pointer: "/gapMaps",
    label: "Gap maps",
    description: "Evidence gap-map destinations.",
    authority: "ownerEdited",
  },
  {
    key: "exports",
    pointer: "/exports",
    label: "Exports",
    description: "Catalog-backed export formats.",
    authority: "catalogDerived",
  },
  {
    key: "sources",
    pointer: "/sources",
    label: "Sources",
    description: "Configured evidence source connections.",
    authority: "catalogDerived",
  },
  {
    key: "services",
    pointer: "/services",
    label: "Services",
    description: "Provisioned database, search, and storage services.",
    authority: "platformProvisioned",
  },
  {
    key: "ai",
    pointer: "/ai",
    label: "AI",
    description: "Catalog-backed providers, models, and prompts.",
    authority: "catalogDerived",
  },
  {
    key: "analytics",
    pointer: "/analytics",
    label: "Analytics",
    description: "Owner-controlled analytics behaviour.",
    authority: "ownerEdited",
  },
  {
    key: "authentication",
    pointer: "/authentication",
    label: "Authentication",
    description: "Platform sign-in wiring and secret.",
    authority: "platformProvisioned",
  },
  {
    key: "email",
    pointer: "/email",
    label: "Email",
    description: "Email delivery behaviour and templates.",
    authority: "catalogDerived",
  },
  {
    key: "generation",
    pointer: "/generation",
    label: "Generation",
    description: "Catalog-backed generation behaviour.",
    authority: "catalogDerived",
  },
  {
    key: "processing",
    pointer: "/processing",
    label: "Processing",
    description: "Catalog-backed processing rules.",
    authority: "catalogDerived",
  },
] as const satisfies readonly SectionDefinition[];

export type SectionKey = (typeof SECTION_REGISTRY)[number]["key"];

const SECTION_KEYS = new Set<string>(SECTION_REGISTRY.map((section) => section.key));

function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === "string" && SECTION_KEYS.has(value);
}

export function getSectionAuthority(sectionKey: SectionKey): FieldAuthority {
  return SECTION_REGISTRY.find((section) => section.key === sectionKey)!
    .authority;
}

// Sections the platform fills at assembly time. Owners never save them.
export const PLATFORM_SECTION_KEYS = SECTION_REGISTRY.filter(
  (section) => section.authority === "platformProvisioned",
).map((section) => section.key);

export function isPlatformSection(sectionKey: SectionKey): boolean {
  return getSectionAuthority(sectionKey) === "platformProvisioned";
}

// Owner sections the runtime schema marks as required at the root. Read from
// the schema so the list never needs a hand-written copy.
export const REQUIRED_OWNER_SECTION_KEYS = schema.required.filter(
  (key): key is SectionKey =>
    isSectionKey(key) &&
    !(ENVELOPE_FIELDS as readonly string[]).includes(key) &&
    !isPlatformSection(key),
);

export function writeOnlyPathToPointerPattern(path: string): `/${string}` {
  const tokens = path.split(".").flatMap((segment) => {
    if (segment.endsWith("[]")) return [segment.slice(0, -2), "*"];
    return [segment];
  });
  return `/${tokens.map(escapeJsonPointerToken).join("/")}`;
}

export const WRITE_ONLY_POINTER_PATTERNS = catalogs.fields.writeOnlyPaths.map(
  writeOnlyPathToPointerPattern,
);

const FIELD_AUTHORITY_OVERRIDES = new Map<string, FieldAuthority>([
  ["/identity/baseUrl", "platformProvisioned"],
]);

function resolveSchemaToken(schema: unknown, token: string): unknown {
  if (!schema || typeof schema !== "object") return undefined;

  const node = schema as {
    properties?: Record<string, unknown>;
    items?: unknown;
    allOf?: unknown[];
    anyOf?: unknown[];
    oneOf?: unknown[];
  };
  const direct = token === "*" ? node.items : node.properties?.[token];
  if (direct !== undefined) return direct;

  for (const alternatives of [node.allOf, node.anyOf, node.oneOf]) {
    if (!alternatives) continue;
    for (const alternative of alternatives) {
      const resolved = resolveSchemaToken(alternative, token);
      if (resolved !== undefined) return resolved;
    }
  }

  return undefined;
}

export function resolveSchemaPointer(
  schema: unknown,
  pointer: string,
): unknown {
  if (pointer === "") return schema;
  if (!pointer.startsWith("/")) return undefined;

  let current: unknown = schema;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = unescapeJsonPointerToken(rawToken);
    current = resolveSchemaToken(current, token);
    if (current === undefined) return undefined;
  }
  return current;
}

export function getFieldAuthority(pointer: string): FieldAuthority | undefined {
  if (
    WRITE_ONLY_POINTER_PATTERNS.some((pattern) =>
      jsonPointerPatternMatches(pattern, pointer),
    )
  ) {
    return "credentialLifecycle";
  }

  const override = FIELD_AUTHORITY_OVERRIDES.get(pointer);
  if (override) return override;

  const sectionKey = unescapeJsonPointerToken(pointer.split("/")[1] ?? "");
  if ((ENVELOPE_FIELDS as readonly string[]).includes(sectionKey)) {
    return "controlPlaneGenerated";
  }
  return SECTION_REGISTRY.find((section) => section.key === sectionKey)
    ?.authority;
}
