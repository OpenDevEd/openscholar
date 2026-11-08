"use client";

import { useEffect } from "react";
import Script from "next/script";
import { useAnalyticsConsent } from "@/lib/consent-storage";
import { GA_CONFIG, GA_CONSENT_DEFAULTS, setGoogleAnalyticsAllowed } from "@/lib/google-analytics-tag";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

/** Google Analytics loads only once someone accepts analytics cookies (lib/google-analytics-tag.ts). The tag counts page changes itself. */
export function ConsentAwareGoogleAnalytics() {
  const shouldCollect = useAnalyticsConsent();
  const isProduction = process.env.NODE_ENV === "production";

  useEffect(() => {
    if (GA_ID) setGoogleAnalyticsAllowed(GA_ID, shouldCollect);
  }, [shouldCollect]);

  if (!GA_ID || !isProduction || !shouldCollect) return null;

  return (
    <>
      <Script id="google-analytics-setup">
        {`window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag("consent", "default", ${JSON.stringify(GA_CONSENT_DEFAULTS)});
gtag("js", new Date());
gtag("config", "${GA_ID}", ${JSON.stringify(GA_CONFIG)});`}
      </Script>
      <Script id="google-analytics" src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
    </>
  );
}
