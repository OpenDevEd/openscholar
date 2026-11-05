"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface CountryFlagProps {
  countryCode: string;
  className?: string;
}

/** A country's flag. Its place is held at its size, and the picture fades in there when it arrives. */
export const CountryFlag = ({ countryCode, className = "" }: CountryFlagProps) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      // A picture already in the browser's cache has loaded before React is listening.
      ref={(image) => {
        if (image?.complete && image.naturalWidth > 0) setLoaded(true);
      }}
      src={`https://flagcdn.com/w20/${countryCode.toLowerCase()}.png`}
      alt=""
      onLoad={() => setLoaded(true)}
      className={cn("inline-block h-3 w-4 rounded-[2px] border border-border bg-muted object-cover transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0", className)}
      width="16"
      height="12"
    />
  );
};
