export const creditsFeatureFlags = {
  enabled: process.env.NEXT_PUBLIC_CREDITS_ENABLED !== "false",
  topupsEnabled: process.env.NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED !== "false",
};
