"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { HoldWhileClosing, TrackOpen, useClosing } from "@/components/ui/hold-while-closing"

const PopoverIsModal = React.createContext(false)
// The trigger's id: an open popover is a dialog, named after what opened it ("Cite", "Funders") unless it names itself.
const PopoverTriggerId = React.createContext<string | undefined>(undefined)

const stopPropagation = (event: React.SyntheticEvent) => event.stopPropagation()
// A dialog's scroll lock cancels these once they reach the document, and a popover's portal sits outside the dialog.
// A modal popover keeps them: its own lock has to see them.
const outOfDialogLock = { onWheel: stopPropagation, onTouchMove: stopPropagation }

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const triggerId = React.useId()
  return (
    <PopoverIsModal.Provider value={props.modal ?? false}>
      <PopoverTriggerId.Provider value={triggerId}>
        <TrackOpen {...props}>{(root) => <PopoverPrimitive.Root data-slot="popover" {...props} {...root} />}</TrackOpen>
      </PopoverTriggerId.Provider>
    </PopoverIsModal.Provider>
  )
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const triggerId = React.useContext(PopoverTriggerId)
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" id={triggerId} {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  collisionPadding = 8,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const closing = useClosing()
  const modal = React.useContext(PopoverIsModal)
  const triggerId = React.useContext(PopoverTriggerId)
  // A popover held to an anchor instead of a trigger has nothing to be named after: it names itself (aria-label). So
  // does a picker whose trigger is a combobox: through aria-labelledby a combobox gives its value, not its name.
  const named = props["aria-label"] || props["aria-labelledby"] ? undefined : triggerId
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        inert={closing}
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none z-50 max-h-(--radix-popover-content-available-height) w-72 origin-(--radix-popover-content-transform-origin) overflow-y-auto rounded-md border p-4 shadow-md outline-hidden",
          className
        )}
        {...(modal ? undefined : outOfDialogLock)}
        aria-labelledby={named}
        {...props}
      >
        {props.asChild ? children : <HoldWhileClosing>{children}</HoldWhileClosing>}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
