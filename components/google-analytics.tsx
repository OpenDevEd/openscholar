"use client";

import { useEffect } from "react";
import Script from "next/script";
import { useAnalyticsConsent } from "@/lib/consent-storage";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

/** A withdrawn consent stops the tag that's already loaded and removes its cookies, which sit on a parent domain. */
function setGoogleAnalyticsAllowed(allowed: boolean) {
  (window as unknown as Record<string, boolean>)[`ga-disable-${GA_ID}`] = !allowed;
  if (allowed) return;
  const domains = window.location.hostname.split(".").map((_, i, parts) => parts.slice(i).join("."));
  for (const cookie of document.cookie.split("; ")) {
    const name = cookie.split("=")[0];
    if (!/^_ga(_|$)/.test(name)) continue;
    for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/; domain=.${domain}`;
  }
}

/**
 * Google Analytics loads only once someone accepts analytics cookies, and advertising stays off, as the privacy
 * policy says. The tag counts page changes itself. The property's own settings keep search text away from
 * Google: the launch plan lists them (plans/production-launch/README.md).
 */
export function ConsentAwareGoogleAnalytics() {
  const shouldCollect = useAnalyticsConsent();
  const isProduction = process.env.NODE_ENV === "production";

  useEffect(() => setGoogleAnalyticsAllowed(shouldCollect), [shouldCollect]);

  if (!GA_ID || !isProduction || !shouldCollect) return null;

  return (
    <>
      <Script id="google-analytics-setup">
        {`window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" });
gtag("js", new Date());
gtag("config", "${GA_ID}", { allow_google_signals: false, allow_ad_personalization_signals: false });`}
      </Script>
      <Script id="google-analytics" src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
    </>
  );
}
