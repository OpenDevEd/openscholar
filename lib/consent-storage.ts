import { useSyncExternalStore } from "react";
import { CONSENT_UPDATED_EVENT, readConsent } from "@/lib/consent-cookie";

function subscribeToConsent(onChange: () => void) {
  window.addEventListener(CONSENT_UPDATED_EVENT, onChange);
  return () => window.removeEventListener(CONSENT_UPDATED_EVENT, onChange);
}

/** Whether someone has accepted analytics, here or on openscholar.ai. */
export function useAnalyticsConsent(): boolean {
  return useSyncExternalStore(subscribeToConsent, () => readConsent()?.choice === "granted", () => false);
}
