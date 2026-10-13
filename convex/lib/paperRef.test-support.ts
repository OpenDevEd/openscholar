// Test rows name their paper the way callers do; these are the fields a stored paper carries for it.
import { legacyPaperRef } from "../../lib/papers/paper-ref";
import { identityOf, type PaperIdentity } from "./paperRef";

/**
 * The identity a paper named by `id` is stored with: its key, or an OpenAlex ID in any form. A made-up ID that names
 * no source (`oa:1`) stands for an uploaded PDF of that name, so each one is still its own paper.
 */
export function paperOf(id: string, hints: { pdfUrl?: string } = {}): PaperIdentity {
  return identityOf(legacyPaperRef(id, hints) ?? { source: "upload", file: id });
}
