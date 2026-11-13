"use client";

import { toast } from "sonner";

/**
 * Copies text to the clipboard and says so. Where the browser refuses, or has no clipboard to write to (an insecure
 * page, an old browser), it says that, and shows the text to select and copy by hand, for long enough to. Returns
 * whether it copied.
 */
export async function copyText(text: string, words: { copied: string; failed: string; select: string }) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(words.copied);
    return true;
  } catch {
    toast.error(words.failed, {
      description: (
        <>
          {words.select}
          <span className="mt-1 block select-all break-all font-mono text-xs">{text}</span>
        </>
      ),
      duration: 20_000,
    });
    return false;
  }
}
