"use client";

// mock (#1354): shared dev's server has no licences yet, so the mock keeps the licence chosen at signing in this
// browser, by report, and lays it over what the server sends: its agreement and byline name the licence, and a report
// under one that takes three activations is priced at three. The real build (the commit before this one) does all of
// this on the server; this file and every `mock:` line go when it ships.

import { useSyncExternalStore } from "react";
import { ConvexError } from "convex/values";
import { choosesLicence } from "@/lib/reports/agreement";
import { DEFAULT_LICENCE, activationsFor, type Licence } from "@/lib/reports/report";
import { licenceInByline, type Series } from "@/lib/reports/settings";

const STORE = (key: string) => `mock:licence:${key}`;
const VOUCHER = (key: string) => `mock:voucher:${key}`;
const CHANGED = "mock-licence";

/** Keeps the licence a report was signed with, and the code applied to its price then. */
export function keepMockLicence(key: string, licence: Licence, voucher?: string) {
  try {
    window.localStorage.setItem(STORE(key), JSON.stringify(licence));
    if (voucher) window.localStorage.setItem(VOUCHER(key), voucher);
    else window.localStorage.removeItem(VOUCHER(key));
  } catch {
    // Without storage the report reads as CC BY 4.0, as one signed on the real server today.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** The browser's storage, heard for changes made here and in other tabs. */
function subscribe(heard: () => void) {
  window.addEventListener("storage", heard);
  window.addEventListener(CHANGED, heard);
  return () => {
    window.removeEventListener("storage", heard);
    window.removeEventListener(CHANGED, heard);
  };
}

/** What this browser keeps under one name, heard for changes. */
function useKept(name: string | null) {
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return name ? window.localStorage.getItem(name) : null;
      } catch {
        return null;
      }
    },
    () => null,
  );
}

/** The licence a report was signed with in this browser; CC BY 4.0 for any other. */
export function useMockLicence(key: string | null | undefined): Licence {
  const kept = useKept(key ? STORE(key) : null);
  return kept ? (JSON.parse(kept) as Licence) : DEFAULT_LICENCE;
}

/** The code applied when a report was signed in this browser, if any. */
export const useMockVoucher = (key: string | null | undefined) => useKept(key ? VOUCHER(key) : null);

/**
 * What a code makes of each licence's price before a report is started, as the real `quoteLicences` answers: dev's
 * two test codes, FREEDOI (all off) and HALFOFF (half off), on the prices the page shows.
 */
export async function mockQuoteLicences(typed: string, prices: { one: number | null; three: number | null }) {
  const code = typed.trim();
  const off = { FREEDOI: 1, HALFOFF: 0.5 }[code.toUpperCase()];
  if (off === undefined) throw new ConvexError({ code: "VALIDATION_ERROR", reason: "unknownCode", message: `${code} isn't a code we know, or it has been used up.` });
  const quote = (price: number | null) => (price === null ? null : { price, total: price * (1 - off) });
  return { one: quote(prices.one), three: quote(prices.three) };
}

/** The agreement as the real build words it: dev's saved one names CC BY 4.0 where the real one has `[licence]`. */
export const mockAgreementText = (text: string) =>
  choosesLicence(text) ? text : text.replace("the Creative Commons Attribution 4.0 licence (CC BY 4.0)", "[licence]").replaceAll("under CC BY 4.0;", "under [licence];");

/** The series' byline as the real build's default words it, with `{licence}` after the DOI. */
export const mockSeries = <S extends Series>(series: S): S => (series.byline.includes("{licence}") ? series : { ...series, byline: `${series.byline}, under {licence}` });

/** A signed byline as the real build makes it: dev's server signed it without its licence. */
export const mockByline = (signed: string, licence: Licence) => (signed.includes(", under ") ? signed : `${signed}, under ${licenceInByline(licence)}`);

/** What activating takes under the report's licence: dev's Autumn has no three-activation plan, so its price is three of the one. */
export const mockTerms = <T extends { activations: number | null; price: number | null }>(terms: T, licence: Licence) => {
  const needs = activationsFor(licence);
  return { ...terms, needs, price: terms.price === null ? null : terms.price * needs };
};
