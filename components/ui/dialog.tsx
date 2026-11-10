"use client"

import { useTranslations } from "next-intl";
import * as React from "react"
import { XIcon } from "@/components/icons"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { HoldWhileClosing, TrackOpen, useClosing } from "@/components/ui/hold-while-closing"
import { withToastsInside } from "@/components/ui/sonner"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <TrackOpen {...props}>{(root) => <DialogPrimitive.Root data-slot="dialog" {...props} {...root} />}</TrackOpen>
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

/** How soon after a dialog opens a click outside it is taken as the rest of the double click that opened it. */
const DOUBLE_CLICK_MS = 500

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  onInteractOutside,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  overlayClassName?: string
}) {
  const t = useTranslations("sharedControls");
  const closing = useClosing()
  const focus = useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus })
  // When it opened: the second click of a double click on what opens it lands outside it a moment later, and
  // mustn't close it again.
  const openedAt = React.useRef(0)
  const outside = withToastsInside(onInteractOutside)
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        inert={closing}
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-lg border p-6 shadow-lg duration-200 outline-none sm:max-w-lg",
          className
        )}
        ref={(node: HTMLDivElement | null) => {
          if (node) openedAt.current = performance.now()
        }}
        onInteractOutside={(event) => {
          if (performance.now() - openedAt.current < DOUBLE_CLICK_MS) event.preventDefault()
          else outside(event)
        }}
        {...props}
        {...focus}
      >
        {props.asChild ? children : <HoldWhileClosing>{children}</HoldWhileClosing>}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 end-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">{t("close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-start", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const t = useTranslations("sharedControls");
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{t("close")}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

type FocusEvents = { onOpenAutoFocus?: (event: Event) => void; onCloseAutoFocus?: (event: Event) => void }

/** The control pressed last, and when: what opened a dialog in a browser that doesn't focus what it clicks. */
let pressed: { control: HTMLElement; at: number } | null = null
/** How long after a press a dialog that opens counts as opened by it. */
const PRESSED_MS = 1500
// The page's pointer is the outside system: one listener for the page's life, kept by the module.
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (event) => {
      const control = event.target instanceof Element ? event.target.closest<HTMLElement>("button, a[href], [role='button'], [tabindex]:not([tabindex='-1'])") : null
      pressed = control ? { control, at: Date.now() } : null
    },
    true
  )
}

/**
 * Gives the focus back to what had it when the dialog opened, once it closes. Radix does that only for a dialog
 * opened by its own trigger: one opened by state or by the address, as most here are, left the focus on the page's
 * body, and the next Tab started from the top of the page.
 */
function useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus }: FocusEvents): Required<FocusEvents> {
  const opener = React.useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus: (event) => {
      // Still what the person pressed: the dialog takes the focus after this. Safari doesn't focus a button it
      // clicks, so there the control pressed a moment ago stands in for the one that would have had the focus.
      const focused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
      opener.current = focused ?? (pressed && Date.now() - pressed.at < PRESSED_MS ? pressed.control : null)
      onOpenAutoFocus?.(event)
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event)
      const back = opener.current
      // Gone, as a row that was deleted is, or never anything: Radix's own choice stands.
      if (event.defaultPrevented || !back?.isConnected || back === document.body) return
      event.preventDefault()
      back.focus()
    },
  }
}

/** For `onOpenAutoFocus`: focuses the dialog itself, not its first button, so no tooltip opens with it. */
function focusContent(event: Event) {
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).focus()
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, focusContent, useReturnFocus };
