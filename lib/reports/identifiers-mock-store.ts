"use client";

// MOCK (mock/identifier-services): the identifier settings and the DOCiD account kept in this browser, so the admin
// page, a community's settings and the signing step agree without a server change. The build keeps them in the
// publisher's settings.
import { useSyncExternalStore } from "react";
import { DEFAULT_IDENTIFIERS, type Identifiers } from "./identifiers";

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {}
  const kept = cache.get(key);
  if (kept && kept.raw === raw) return kept.value as T;
  let value = fallback;
  try {
    value = raw ? ({ ...fallback, ...(JSON.parse(raw) as T) } as T) : fallback;
  } catch {}
  cache.set(key, { raw, value });
  return value;
}

function write<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  listeners.forEach((listener) => listener());
}

function useKept<T>(key: string, fallback: T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => event.key === key && listener();
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => read(key, fallback),
    () => fallback,
  );
}

export const useMockIdentifiers = () => useKept<Identifiers>("mock:identifiers", DEFAULT_IDENTIFIERS);
export const setMockIdentifiers = (next: Identifiers) => write("mock:identifiers", next);

export type MockDocid = { on: boolean; email: string; resourceType: string; publicationType: string; funderType: string };
const NO_DOCID: MockDocid = { on: false, email: "", resourceType: "", publicationType: "5", funderType: "1" };
export const useMockDocid = () => useKept<MockDocid>("mock:docid", NO_DOCID);
export const setMockDocid = (next: MockDocid) => write("mock:docid", next);
