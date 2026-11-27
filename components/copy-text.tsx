"use client";

import { toast } from "sonner";

// The notice of the last copy. A newer result closes it, so a copy that works after a refused one takes the refusal away.
// Each result is a toast of its own: reusing one id would update a toast that may be leaving, and go with it.
let last: string | number | undefined;

/**
 * Copies text to the clipboard and says so. Where the browser refuses, or has no clipboard to write to (an insecure
 * page, an old browser), it says that, and shows the text to select and copy by hand, for long enough to. Where the
 * text is on the page already (`shown`), as in a dialog the toast can't be reached from, that is selected instead.
 * Returns whether it copied.
 */
/** Takes the last copy toast away, where what it is about has left the screen (another tab of a dialog). */
export const dismissCopied = () => {
  if (last !== undefined) toast.dismiss(last);
};

export async function copyText(text: string, words: { copied: string; failed: string; select: string; selected?: string }, shown?: HTMLElement | null) {
  let copied = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    copied = false;
  }
  if (last !== undefined) toast.dismiss(last);
  if (!copied && shown) {
    window.getSelection()?.selectAllChildren(shown);
    last = toast.error(words.failed, { description: words.selected ?? words.select, duration: 8_000 });
    return false;
  }
  last = copied
    ? toast.success(words.copied)
    : toast.error(words.failed, {
        description: (
          <>
            {words.select}
            {/* A box of its own: clicking in it selects its text, and select-all stays inside it. */}
            <textarea readOnly value={text} rows={4} onFocus={(event) => event.currentTarget.select()} className="mt-1.5 block w-full resize-none rounded-md border border-border-subtle bg-background p-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
          </>
        ),
        duration: 20_000,
      });
  return copied;
}
