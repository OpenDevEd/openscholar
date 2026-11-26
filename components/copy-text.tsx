"use client";

import { toast } from "sonner";

// The notice of the last copy. A newer result closes it, so a copy that works after a refused one takes the refusal away.
// Each result is a toast of its own: reusing one id would update a toast that may be leaving, and go with it.
let last: string | number | undefined;

/**
 * Copies text to the clipboard and says so. Where the browser refuses, or has no clipboard to write to (an insecure
 * page, an old browser), it says that, and shows the text to select and copy by hand, for long enough to. Returns
 * whether it copied.
 */
export async function copyText(text: string, words: { copied: string; failed: string; select: string }) {
  let copied = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    copied = false;
  }
  if (last !== undefined) toast.dismiss(last);
  last = copied
    ? toast.success(words.copied)
    : toast.error(words.failed, {
        description: (
          <>
            {words.select}
            <span className="mt-1 block select-all font-mono text-xs [overflow-wrap:anywhere]">{text}</span>
          </>
        ),
        duration: 20_000,
      });
  return copied;
}
