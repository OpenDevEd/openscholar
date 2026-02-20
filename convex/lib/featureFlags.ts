export function requireCreditsEnabled(): void {
  if (process.env.NEXT_PUBLIC_CREDITS_ENABLED === "false") {
    throw new Error("Credits feature is disabled");
  }
}

export function requireSubscriptionsEnabled(): void {
  if (process.env.NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED === "false") {
    throw new Error("Subscriptions feature is disabled");
  }
}
