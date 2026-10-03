import type { PaperResult } from "@/lib/types/search.types";
import { useRatingsStore } from "@/lib/store";
import {
  downloadAsFile,
  generateFilename,
  getRatingOrNull,
  jsonToCSV,
} from "@/lib/utils";

/**
 * Download a single library paper as JSON or CSV (full data), with the person's rating of
 * it, read as the download starts.
 */
export async function downloadLibraryItem(
  item: PaperResult,
  format: "json" | "csv",
): Promise<void> {
  const ratings = await useRatingsStore.getState().readRatings([item.id]);
  const data = {
    ...item,
    rating: getRatingOrNull(ratings, item.id),
  };
  const filename = generateFilename(item.title || "", "", format);

  if (format === "json") {
    downloadAsFile(JSON.stringify(data, null, 2), filename, "json");
  } else {
    downloadAsFile(jsonToCSV(data as Parameters<typeof jsonToCSV>[0]), filename, "csv");
  }
}

/**
 * Download essential fields only for a single library paper.
 */
export async function downloadLibraryEssentialItem(
  item: PaperResult,
  format: "json" | "csv",
): Promise<void> {
  const ratings = await useRatingsStore.getState().readRatings([item.id]);
  const essentialInfo = {
    id: item.id,
    title: item.title,
    authors:
      item.authorships
        ?.map((a) => a.author.display_name)
        .join(", ") || "",
    year: item.publication_year,
    abstract: item.abstract || "",
    rating: getRatingOrNull(ratings, item.id),
    ...(item.doi ? { doi: item.doi } : {}),
    ...(item.open_access?.oa_url
      ? { pdf_url: item.open_access.oa_url }
      : {}),
  };
  const filename = generateFilename(item.title || "", "essential", format);

  if (format === "json") {
    downloadAsFile(JSON.stringify(essentialInfo, null, 2), filename, "json");
  } else {
    downloadAsFile(jsonToCSV(essentialInfo), filename, "csv");
  }
}
