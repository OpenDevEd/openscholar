"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/** How far content fades at an edge that has more to scroll; the same fade as the assistant's thread. */
export const EDGE_FADE = 18

function ScrollArea({
  className,
  children,
  shades = false,
  axis = "y",
  // Its bar shows whenever the content overflows, not only under the pointer: what scrolls shows that it does.
  type = "auto",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /** Fades the content out at an edge that has more to scroll. */
  shades?: boolean
  /** Which way it scrolls: down the page, sideways (a wide table), or both. The bar lies over the content and takes no room. */
  axis?: "y" | "x" | "both"
}) {
  const viewport = React.useRef<HTMLDivElement>(null)
  const content = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ top: false, bottom: false, start: false, end: false })
  const measure = React.useCallback(() => {
    const el = viewport.current
    if (!el) return
    const top = el.scrollTop > 1
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    // Sideways, a right-to-left page counts its scroll down from zero.
    const along = Math.abs(el.scrollLeft)
    const start = along > 1
    const end = along + el.clientWidth < el.scrollWidth - 1
    setEdges((e) => (e.top === top && e.bottom === bottom && e.start === start && e.end === end ? e : { top, bottom, start, end }))
  }, [])
  const fade = (to: string, from: boolean, until: boolean) =>
    `linear-gradient(${to}, transparent, black ${from ? EDGE_FADE : 0}px, black calc(100% - ${until ? EDGE_FADE : 0}px), transparent)`
  // The content's size is an outside system: rows arrive, filters change it, the window resizes.
  React.useEffect(() => {
    if (!shades) return
    const observer = new ResizeObserver(measure)
    if (viewport.current) observer.observe(viewport.current)
    if (content.current) observer.observe(content.current)
    measure()
    return () => observer.disconnect()
  }, [shades, measure])
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      // A column, so the viewport takes the root's height by flex: a percentage height doesn't resolve
      // when the root is itself sized by a container with only a maximum height, and the list then
      // runs over what's under it without scrolling.
      className={cn("relative flex flex-col", className)}
      type={type}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewport}
        data-slot="scroll-area-viewport"
        onScroll={shades ? measure : undefined}
        style={
          shades
            ? {
                // One fade for each way it scrolls: where it scrolls both ways, what shows is what both let through.
                maskImage: [axis !== "x" ? fade("to bottom", edges.top, edges.bottom) : "", axis !== "y" ? fade("to right", edges.start, edges.end) : ""].filter(Boolean).join(", "),
                maskComposite: "intersect",
              }
            : undefined
        }
        className={cn(
          "focus-visible:ring-ring/50 size-full min-h-0 flex-1 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
          // Radix lays its content out as a table, which lets long text grow instead of truncating.
          shades && axis === "y" && "[&>div]:!block"
        )}
      >
        {shades ? <div ref={content}>{children}</div> : children}
      </ScrollAreaPrimitive.Viewport>
      {axis !== "x" ? <ScrollBar /> : null}
      {axis !== "y" ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-s border-s-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        // The same weight as the page's own bar, so a part that scrolls is seen to.
        className="bg-foreground/25 relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea };
