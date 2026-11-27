import * as React from "react"

import { cn } from "@/lib/utils"

/** The field look, for textareas that render through another component (rich-textarea). */
// `unicode-bidi: plaintext`: what someone writes runs the way its language does (Arabic from the right on an English page), and an empty field keeps the page's own direction, where `dir="auto"` would turn it left to right.
export const TEXTAREA_CLASS =
  "[unicode-bidi:plaintext] border-input placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full rounded-md border bg-field px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    data-slot="textarea"
    className={cn(TEXTAREA_CLASS, className)}
    {...props}
  />
));

Textarea.displayName = "Textarea";

export { Textarea }
