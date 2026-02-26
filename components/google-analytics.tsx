"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";
import { GoogleAnalytics, sendGAEvent } from "@next/third-parties/google";
import {
  getStoredConsent,
  shouldCollectAnalytics,
  CONSENT_UPDATED_EVENT,
} from "@/lib/consent-storage";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

function useShouldCollectAnalytics() {
  const [shouldCollect, setShouldCollect] = useState(false);

  useEffect(() => {
    setShouldCollect(shouldCollectAnalytics());

    const handler = () => setShouldCollect(shouldCollectAnalytics());
    window.addEventListener(CONSENT_UPDATED_EVENT, handler);
    return () => window.removeEventListener(CONSENT_UPDATED_EVENT, handler);
  }, []);

  return shouldCollect;
}

/** Tracks page views on client-side navigation (App Router). Skips initial load since gtag config sends it. */
function PageViewTracker() {
  const pathname = usePathname();
  const isInitial = useRef(true);

  useEffect(() => {
    if (!pathname || typeof window === "undefined") return;
    if (!shouldCollectAnalytics()) return;

    if (isInitial.current) {
      isInitial.current = false;
      return;
    }

    sendGAEvent("event", "page_view", {
      page_path: pathname,
      page_title: document.title,
    });
  }, [pathname]);

  return null;
}

/**
 * Consent-aware Google Analytics 4 component.
 * Only loads GA when user has accepted analytics cookies (GDPR).
 * Tracks page views on route changes for App Router.
 */
export function ConsentAwareGoogleAnalytics() {
  const shouldCollect = useShouldCollectAnalytics();
  const isProduction = process.env.NODE_ENV === "production";

  if (!GA_ID || !isProduction || !shouldCollect) return null;

  return (
    <>
      <GoogleAnalytics gaId={GA_ID} />
      <PageViewTracker />
    </>
  );
}
