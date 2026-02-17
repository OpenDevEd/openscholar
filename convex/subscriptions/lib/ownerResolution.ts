export function resolveOwnerIdForSubscriptionSync(args: {
  existingSubscriptionOwnerId?: string | null;
  linkedBillingCustomerUserId?: string | null;
  componentCustomerMetadataUserId?: string | null;
  subscriptionMetadataUserId?: string | null;
}): string | undefined {
  if (args.existingSubscriptionOwnerId) return args.existingSubscriptionOwnerId;
  if (args.linkedBillingCustomerUserId) return args.linkedBillingCustomerUserId;
  if (args.componentCustomerMetadataUserId) return args.componentCustomerMetadataUserId;
  if (args.subscriptionMetadataUserId) return args.subscriptionMetadataUserId;
  return undefined;
}
