"use server";

import { getPaperCitations } from "@/lib/citations/server";

export async function createPaperCitations(data: unknown, locale: string) {
  return getPaperCitations(data, locale);
}
