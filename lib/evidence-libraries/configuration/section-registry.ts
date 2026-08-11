import catalogs from "./generated/library-config.catalogs.json";

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
    description: "Catalog-backed sign-in capabilities.",
    authority: "catalogDerived",
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

function escapePointerToken(token: string) {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapePointerToken(token: string) {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function writeOnlyPathToPointerPattern(path: string): `/${string}` {
  const tokens = path.split(".").flatMap((segment) => {
    if (segment.endsWith("[]")) return [segment.slice(0, -2), "*"];
    return [segment];
  });
  return `/${tokens.map(escapePointerToken).join("/")}`;
}

export const WRITE_ONLY_POINTER_PATTERNS = catalogs.fields.writeOnlyPaths.map(
  writeOnlyPathToPointerPattern,
);

export function resolveSchemaPointer(
  schema: unknown,
  pointer: string,
): unknown {
  if (pointer === "") return schema;
  if (!pointer.startsWith("/")) return undefined;

  let current: unknown = schema;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = unescapePointerToken(rawToken);
    if (!current || typeof current !== "object") return undefined;
    const node = current as {
      properties?: Record<string, unknown>;
      items?: unknown;
    };
    if (token === "*") {
      current = node.items;
      continue;
    }
    current = node.properties?.[token];
  }
  return current;
}

function pointerMatches(pattern: string, pointer: string) {
  const patternTokens = pattern.split("/");
  const pointerTokens = pointer.split("/");
  return (
    patternTokens.length === pointerTokens.length &&
    patternTokens.every(
      (token, index) => token === "*" || token === pointerTokens[index],
    )
  );
}

export function getFieldAuthority(pointer: string): FieldAuthority | undefined {
  if (
    WRITE_ONLY_POINTER_PATTERNS.some((pattern) =>
      pointerMatches(pattern, pointer),
    )
  ) {
    return "credentialLifecycle";
  }

  const sectionKey = unescapePointerToken(pointer.split("/")[1] ?? "");
  if ((ENVELOPE_FIELDS as readonly string[]).includes(sectionKey)) {
    return "controlPlaneGenerated";
  }
  return SECTION_REGISTRY.find((section) => section.key === sectionKey)
    ?.authority;
}
