"use client";

import { toast } from "sonner";

/**
 * Copies text to the clipboard and says so. Where the browser refuses, it says that, and shows the text to select and
 * copy by hand, for long enough to.
 */
export function copyText(text: string, words: { copied: string; failed: string; select: string }) {
  void navigator.clipboard.writeText(text).then(
    () => void toast.success(words.copied),
    () =>
      void toast.error(words.failed, {
        description: (
          <>
            {words.select}
            <span className="mt-1 block select-all break-all font-mono text-xs">{text}</span>
          </>
        ),
        duration: 20_000,
      }),
  );
}
