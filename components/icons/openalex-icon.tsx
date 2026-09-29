import type { ComponentPropsWithoutRef, CSSProperties } from "react";

import { cn } from "@/lib/utils";

const OPENALEX_TRICON_URL = "/openalex-tricon.png";

const MASK_STYLE: CSSProperties = {
  WebkitMaskImage: `url(${OPENALEX_TRICON_URL})`,
  maskImage: `url(${OPENALEX_TRICON_URL})`,
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskSize: "contain",
  maskSize: "contain",
};

export type OpenAlexIconProps = Omit<
  ComponentPropsWithoutRef<"span">,
  "children"
>;

export function OpenAlexIcon({
  className,
  style,
  "aria-hidden": ariaHidden = true,
  ...rest
}: OpenAlexIconProps) {
  return (
    <span
      data-icon="openalex"
      aria-hidden={ariaHidden}
      className={cn("inline-block bg-current", className)}
      style={{ ...MASK_STYLE, ...style }}
      {...rest}
    />
  );
}
