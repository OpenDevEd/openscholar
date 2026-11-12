"use client";

// mock (#1354): shared dev's server has no licences yet, so the mock keeps the licence chosen at signing in this
// browser, by report, and lays it over what the server sends: its agreement and byline name the licence, and a report
// under one that takes three activations is priced at three. The real build (the commit before this one) does all of
// this on the server; this file and every `mock:` line go when it ships.

import { useSyncExternalStore } from "react";
import { choosesLicence } from "@/lib/reports/agreement";
import { DEFAULT_LICENCE, activationsFor, type Licence } from "@/lib/reports/report";
import { licenceInByline, type Series } from "@/lib/reports/settings";

const STORE = (key: string) => `mock:licence:${key}`;
const CHANGED = "mock-licence";

/** Keeps the licence a report was signed with. */
export function keepMockLicence(key: string, licence: Licence) {
  try {
    window.localStorage.setItem(STORE(key), JSON.stringify(licence));
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

/** The licence a report was signed with in this browser, as its JSON; CC BY 4.0 for any other. */
export function useMockLicence(key: string | null | undefined): Licence {
  const kept = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return key ? window.localStorage.getItem(STORE(key)) : null;
      } catch {
        return null;
      }
    },
    () => null,
  );
  return kept ? (JSON.parse(kept) as Licence) : DEFAULT_LICENCE;
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
