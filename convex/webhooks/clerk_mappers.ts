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
