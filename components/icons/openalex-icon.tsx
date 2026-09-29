import type { ComponentPropsWithoutRef, CSSProperties } from "react";

import { cn } from "@/lib/utils";

export type OpenAlexIconProps = Omit<
  ComponentPropsWithoutRef<"span">,
  "children"
>;

/** A service's mark, drawn in the current text colour like the other icons. */
function markIcon(name: string, src: string) {
  const mask: CSSProperties = {
    WebkitMaskImage: `url(${src})`,
    maskImage: `url(${src})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
  return function MarkIcon({
    className,
    style,
    "aria-hidden": ariaHidden = true,
    ...rest
  }: OpenAlexIconProps) {
    return (
      <span
        data-icon={name}
        aria-hidden={ariaHidden}
        className={cn("inline-block bg-current", className)}
        style={{ ...mask, ...style }}
        {...rest}
      />
    );
  };
}

export const OpenAlexIcon = markIcon("openalex", "/openalex-tricon.png");
/** OpenScholar's open-book mark, heavier than the site logo so it reads at icon size. */
export const OpenScholarIcon = markIcon("openscholar", "/openscholar-mark.svg");
