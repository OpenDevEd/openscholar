import { Doc } from "../_generated/dataModel";

/**
 * All available permissions in the system
 */
export const PERMISSIONS = {
  credits: {
    view: "credits:view",
    manage: "credits:manage",
  },
  members: {
    view: "members:view",
    invite: "members:invite",
    remove: "members:remove",
  },
  settings: {
    view: "settings:view",
    edit: "settings:edit",
  },
  apiKeys: {
    view: "api_keys:view",
    manage: "api_keys:manage",
  },
  billing: {
    view: "billing:view",
    manage: "billing:manage",
  },
} as const;

/**
 * Default permissions for each role
 */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: Object.values(PERMISSIONS).flatMap((p) => Object.values(p)),
  admin: [
    PERMISSIONS.credits.view,
    PERMISSIONS.credits.manage,
    PERMISSIONS.members.view,
    PERMISSIONS.members.invite,
    PERMISSIONS.settings.view,
    PERMISSIONS.settings.edit,
    PERMISSIONS.billing.view,
  ],
  member: [
    PERMISSIONS.credits.view,
    PERMISSIONS.members.view,
    PERMISSIONS.settings.view,
  ],
};

/**
 * Check if a membership has a specific permission
 */
export function hasPermission(
  membership: Pick<Doc<"memberships">, "role" | "permissions">,
  permission: string
): boolean {
  const rolePerms = ROLE_PERMISSIONS[membership.role] ?? [];
  return (
    rolePerms.includes(permission) || membership.permissions.includes(permission)
  );
}

/**
 * Check if a membership has all specified permissions
 */
export function hasAllPermissions(
  membership: Pick<Doc<"memberships">, "role" | "permissions">,
  permissions: string[]
): boolean {
  return permissions.every((p) => hasPermission(membership, p));
}

/**
 * Check if a membership has any of the specified permissions
 */
export function hasAnyPermission(
  membership: Pick<Doc<"memberships">, "role" | "permissions">,
  permissions: string[]
): boolean {
  return permissions.some((p) => hasPermission(membership, p));
}

/**
 * Get all permissions for a membership (role + custom)
 */
export function getAllPermissions(
  membership: Pick<Doc<"memberships">, "role" | "permissions">
): string[] {
  const rolePerms = ROLE_PERMISSIONS[membership.role] ?? [];
  return [...new Set([...rolePerms, ...membership.permissions])];
}
