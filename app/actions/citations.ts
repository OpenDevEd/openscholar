"use server";

import { getPaperCitationMetadata } from "@/lib/citations/server";

export async function enrichPaperCitationMetadata(data: unknown) {
  return getPaperCitationMetadata(data);
}
