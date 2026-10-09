import { convertUsdToCredits } from "./convert";

/** What OpenAlex charges for one cached PDF: $10 per 1,000 downloads (help.openalex.org/access/example-costs). */
export const PAPER_PDF_USD = 0.01;
/** What a paper's PDF from the paper PDF store or from OpenAlex costs a chat or an extraction, once (convex/lib/paperPdfs.ts). */
export const PAPER_PDF_CREDITS = convertUsdToCredits({ usd: PAPER_PDF_USD });
