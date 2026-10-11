"use client";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import type { ComponentProps } from "react";
import {
  memo
} from "react";
import { Streamdown } from "streamdown";
export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code };

/**
 * Streamdown memoizes on its text, so a changed tag list or component map
 * would keep the old rendering; keying on them remounts it instead.
 */
function getRendererSignature({
  allowedTags,
  components,
}: Pick<MessageResponseProps, "allowedTags" | "components">) {
  const allowedTagSignature = allowedTags
    ? Object.entries(allowedTags)
        .map(([tag, attrs]) => `${tag}:${attrs.join(",")}`)
        .sort()
        .join("|")
    : "";
  const componentSignature = components
    ? Object.keys(components).sort().join(",")
    : "";
  return `${allowedTagSignature}::${componentSignature}`;
}

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      key={getRendererSignature(props)}
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      plugins={streamdownPlugins}
      {...props}
    />
  )
);

MessageResponse.displayName = "MessageResponse";
