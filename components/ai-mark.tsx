"use client";

import { useEffect, useId, useMemo, useRef, type ComponentPropsWithoutRef } from "react";
import { aiMarkParts, play, stop } from "@/public/assistant-branding/ai-mark";
import { cn } from "@/lib/utils";

type MarkProps = Omit<ComponentPropsWithoutRef<"svg">, "children"> & {
  /** Drawn size in pixels; below 28 the compact drawing is used. A size class still sets the box. */
  size?: number | string;
  /** How the mark moves: Gather, Draw, Focus or Orbit. */
  variant?: "gather" | "draw" | "focus" | "orbit";
  /** Loops while AI works, then finishes its cycle and settles when work stops. */
  working?: boolean;
};

// Hovering the control a mark sits in plays the mark's hover.
const HOVER_HOST = "button, a, label, [role='button'], [role='menuitem'], [role='tab']";

function Mark({ shape, size = 16, variant = "orbit", working = false, className, ...props }: MarkProps & { shape: "ai" | "translate" }) {
  const svg = useRef<SVGSVGElement>(null);
  const started = useRef(false);
  // Mask ids must be unique and identical on the server and the client.
  const id = `ai-${useId().replace(/[^\w-]/g, "")}`;
  const pixels = typeof size === "number" ? size : Number.parseFloat(size) || 16;
  const { body, attributes } = useMemo(() => aiMarkParts(pixels, { shape, variant, id }), [pixels, shape, variant, id]);

  // The Web Animations timeline is outside React. The mark plays its load once, then loops while working.
  useEffect(() => {
    const node = svg.current!;
    if (working) play(node, "loop");
    else if (started.current) stop(node);
    else play(node, "load");
    started.current = true;
  }, [working]);

  useEffect(() => {
    const node = svg.current!;
    const host = node.closest(HOVER_HOST);
    if (!host) return;
    const hover = () => play(node, "hover");
    host.addEventListener("pointerenter", hover);
    return () => host.removeEventListener("pointerenter", hover);
  }, []);

  return (
    <svg
      ref={svg}
      viewBox="0 0 128 128"
      width={size}
      height={size}
      aria-hidden
      {...attributes}
      {...props}
      className={cn("ai-mark", className)}
      // Authored SVG only, shared with the design preview. No user or model content enters it.
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

/** Marks a feature that uses AI. Use it wherever AI acts, and set `working` while it does. */
export function AiMark(props: MarkProps) {
  return <Mark shape="ai" {...props} />;
}

/** The AI mark's translation form: a globe behind a letter tile that flips through the app's scripts. */
export function TranslateMark(props: MarkProps) {
  return <Mark shape="translate" {...props} />;
}
