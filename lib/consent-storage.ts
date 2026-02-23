/**
 * Cookie consent storage utilities for GDPR compliance.
 * Stores consent records with timestamp and version for audit purposes.
 */

const CONSENT_STORAGE_KEY = "openscholar_cookie_consent";
const POLICY_VERSION = "1.0";

export interface ConsentRecord {
  version: string;
  timestamp: string;
  choice: "granted" | "denied";
  policyVersion: string;
}

export function getStoredConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentRecord;
    return parsed?.choice && parsed?.timestamp ? parsed : null;
  } catch {
    return null;
  }
}

export const CONSENT_UPDATED_EVENT = "openscholar-consent-updated";

export function storeConsent(choice: "granted" | "denied"): void {
  if (typeof window === "undefined") return;

  const record: ConsentRecord = {
    version: "1.0",
    timestamp: new Date().toISOString(),
    choice,
    policyVersion: POLICY_VERSION,
  };

  localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  window.dispatchEvent(new CustomEvent(CONSENT_UPDATED_EVENT));
}

export function hasConsentDecision(): boolean {
  return getStoredConsent() !== null;
}
