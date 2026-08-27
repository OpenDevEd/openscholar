export type ClerkEmailAddressPayload = {
  id: string;
  email_address: string;
};

export type ClerkUserPayload = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmailAddressPayload[];
};

export type ClerkUserUpsertArgs = {
  clerkId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
};

export type ClerkUserDeleteArgs = {
  clerkId: string;
};

export type ClerkOrganizationSnapshot = {
  clerkOrganizationId: string;
  name: string;
  slug: string;
  imageUrl?: string;
  /** Whether the platform team switched Evidence Libraries on for this organisation. */
  evidenceLibrariesEnabled: boolean;
  clerkCreatedAt: number;
  clerkUpdatedAt: number;
};

export type ClerkMembershipSnapshot = {
  clerkMembershipId: string;
  clerkUserId: string;
  role: "org:admin" | "org:member";
  state: "active" | "revoked";
  clerkCreatedAt: number;
  clerkUpdatedAt: number;
  organization: ClerkOrganizationSnapshot;
};

export type ClerkProjectionEvent =
  | {
      kind: "organization";
      action: "upsert";
      entityId: string;
      organization: ClerkOrganizationSnapshot;
    }
  | {
      kind: "organization";
      action: "delete";
      entityId: string;
    }
  | {
      kind: "membership";
      action: "upsert" | "delete";
      entityId: string;
      membership: ClerkMembershipSnapshot;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The Evidence Libraries switch, read from the Clerk organisation's public
 * metadata. The platform team sets `{ "evidenceLibraries": true }` in the
 * Clerk dashboard. Only the boolean `true` counts; a missing key, `false`,
 * the string "true", or anything else means off.
 */
function readEvidenceLibrariesSwitch(organization: Record<string, unknown>): boolean {
  const publicMetadata = asRecord(organization.public_metadata);
  return publicMetadata?.evidenceLibraries === true;
}

function mapOrganizationSnapshot(value: unknown): ClerkOrganizationSnapshot | null {
  const organization = asRecord(value);
  if (
    !organization ||
    typeof organization.id !== "string" ||
    typeof organization.name !== "string" ||
    typeof organization.slug !== "string" ||
    typeof organization.created_at !== "number" ||
    typeof organization.updated_at !== "number" ||
    (organization.image_url !== undefined &&
      organization.image_url !== null &&
      typeof organization.image_url !== "string")
  ) {
    return null;
  }

  return {
    clerkOrganizationId: organization.id,
    name: organization.name,
    slug: organization.slug,
    imageUrl:
      typeof organization.image_url === "string"
        ? organization.image_url
        : undefined,
    evidenceLibrariesEnabled: readEvidenceLibrariesSwitch(organization),
    clerkCreatedAt: organization.created_at,
    clerkUpdatedAt: organization.updated_at,
  };
}

function mapMembershipSnapshot(
  value: unknown,
  state: "active" | "revoked",
): ClerkMembershipSnapshot | null {
  const membership = asRecord(value);
  const publicUserData = asRecord(membership?.public_user_data);
  const organization = mapOrganizationSnapshot(membership?.organization);
  if (
    !membership ||
    typeof membership.id !== "string" ||
    (membership.role !== "org:admin" && membership.role !== "org:member") ||
    typeof membership.created_at !== "number" ||
    typeof membership.updated_at !== "number" ||
    !publicUserData ||
    typeof publicUserData.user_id !== "string" ||
    !organization
  ) {
    return null;
  }

  return {
    clerkMembershipId: membership.id,
    clerkUserId: publicUserData.user_id,
    role: membership.role,
    state,
    clerkCreatedAt: membership.created_at,
    clerkUpdatedAt: membership.updated_at,
    organization,
  };
}

export function parseClerkProjectionEvent(
  eventType: string,
  data: unknown,
): ClerkProjectionEvent | null {
  if (eventType === "organization.deleted") {
    const organization = asRecord(data);
    return typeof organization?.id === "string"
      ? {
          kind: "organization",
          action: "delete",
          entityId: organization.id,
        }
      : null;
  }

  if (eventType === "organization.created" || eventType === "organization.updated") {
    const organization = mapOrganizationSnapshot(data);
    return organization
      ? {
          kind: "organization",
          action: "upsert",
          entityId: organization.clerkOrganizationId,
          organization,
        }
      : null;
  }

  const membershipState =
    eventType === "organizationMembership.deleted"
      ? "revoked"
      : eventType === "organizationMembership.created" ||
          eventType === "organizationMembership.updated"
        ? "active"
        : null;
  if (!membershipState) {
    return null;
  }

  const membership = mapMembershipSnapshot(data, membershipState);
  return membership
    ? {
        kind: "membership",
        action: membershipState === "revoked" ? "delete" : "upsert",
        entityId: membership.clerkMembershipId,
        membership,
      }
    : null;
}

function resolvePrimaryEmail(user: ClerkUserPayload): string | undefined {
  const emails = user.email_addresses ?? [];

  if (user.primary_email_address_id) {
    const primary = emails.find((email) => email.id === user.primary_email_address_id);
    if (primary?.email_address) {
      return primary.email_address;
    }
  }

  const first = emails.find((email) => typeof email.email_address === "string");
  return first?.email_address;
}

export function mapClerkUserToUpsertArgs(user: ClerkUserPayload): ClerkUserUpsertArgs {
  return {
    clerkId: user.id,
    email: resolvePrimaryEmail(user) ?? `${user.id}@clerk.local`,
    firstName: user.first_name ?? undefined,
    lastName: user.last_name ?? undefined,
    avatarUrl: user.image_url ?? undefined,
  };
}

export function mapClerkUserToDeleteArgs(user: ClerkUserPayload): ClerkUserDeleteArgs {
  return { clerkId: user.id };
}
