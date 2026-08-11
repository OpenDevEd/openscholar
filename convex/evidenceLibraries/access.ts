export type OrganizationRole = "org:admin" | "org:member";

export type OrganizationClaims = {
  organizationId: string;
  role: OrganizationRole;
  canManage: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOrganizationClaims(identity: unknown): OrganizationClaims | null {
  if (!isRecord(identity) || !isRecord(identity.o)) return null;

  const organizationId = identity.o.id;
  const role = identity.o.rol;
  if (typeof organizationId !== "string" || organizationId.length === 0) return null;
  if (role !== "org:admin" && role !== "org:member") return null;

  return {
    organizationId,
    role,
    canManage: role === "org:admin",
  };
}
