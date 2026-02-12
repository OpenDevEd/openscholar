export type WorkOSUserPayload = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profilePictureUrl?: string | null;
};

export type WorkOSOrgPayload = {
  id: string;
  name: string;
};

export type WorkOSMembershipPayload = {
  userId: string;
  organizationId: string;
  role?: { slug?: string } | null;
};

export type WorkOSUserSyncArgs = {
  workosId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
};

export type WorkOSMembershipSyncArgs = {
  userWorkosId: string;
  orgWorkosId: string;
  role: "owner" | "admin" | "member";
};

export type WorkOSMembershipRemoveArgs = {
  userWorkosId: string;
  orgWorkosId: string;
};

export function mapWorkosRole(slug?: string): "owner" | "admin" | "member" {
  if (slug === "owner" || slug === "org:owner") return "owner";
  if (slug === "admin" || slug === "org:admin") return "admin";
  return "member";
}

export function mapWorkosUserToSyncArgs(
  user: WorkOSUserPayload,
): WorkOSUserSyncArgs {
  return {
    workosId: user.id,
    email: user.email,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    avatarUrl: user.profilePictureUrl ?? undefined,
  };
}

export function mapWorkosMembershipToSyncArgs(
  membership: WorkOSMembershipPayload,
): WorkOSMembershipSyncArgs {
  return {
    userWorkosId: membership.userId,
    orgWorkosId: membership.organizationId,
    role: mapWorkosRole(membership.role?.slug),
  };
}

export function mapWorkosMembershipToRemoveArgs(
  membership: WorkOSMembershipPayload,
): WorkOSMembershipRemoveArgs {
  return {
    userWorkosId: membership.userId,
    orgWorkosId: membership.organizationId,
  };
}
