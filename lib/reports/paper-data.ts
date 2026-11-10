import "server-only";
import { cache } from "react";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { isReportKey } from "./report";

/**
 * What a report's address shows: a live report, or one withdrawn after going live; null for any other key. Read once
 * a request and never kept longer, so a correction or a withdrawal shows on the next visit.
 */
export const readReport = cache(async (key: string) => (isReportKey(key) ? await fetchQuery(api.reports.paper.get, { key }) : null));
