const BILLING_TEST_USER_EMAIL =
  /^billing-e2e-\d+-[a-z0-9]+\+clerk_test@example\.com$/i;

export async function cleanupStaleBillingClerkUsers(
  clerkClient,
  organizationId,
) {
  const memberships =
    await clerkClient.organizations.getOrganizationMembershipList({
      organizationId,
      emailAddressQuery: "billing-e2e-",
      limit: 100,
    });

  const staleUserIds = memberships.data.flatMap((membership) => {
    const user = membership.publicUserData;
    if (!user || !BILLING_TEST_USER_EMAIL.test(user.identifier)) {
      return [];
    }
    return [user.userId];
  });

  await Promise.all(
    staleUserIds.map((userId) => clerkClient.users.deleteUser(userId)),
  );

  return staleUserIds.length;
}
