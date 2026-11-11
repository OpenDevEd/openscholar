"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "@/components/icons"
import { Spinner } from "@/components/ui/spinner"

import { cn } from "@/lib/utils"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

/**
 * The search box of a list. `busy` says a search is under way, from the first key until its answer is in: the
 * magnifier turns into a spinner in its place, so nothing moves.
 */
function CommandInput({
  className,
  busy = false,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & { busy?: boolean }) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-9 items-center gap-2 border-b px-3"
    >
      {busy ? <Spinner className="size-4 shrink-0 opacity-50" /> : <SearchIcon className="size-4 shrink-0 opacity-50" />}
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        // Named by what it searches for, as its placeholder says, unless it's given a name of its own.
        aria-label={props["aria-label"] ?? (typeof props.placeholder === "string" ? props.placeholder : undefined)}
        {...props}
      />
    </div>
  )
}

/** `grows` is for results that arrive later, such as a search sent away: they fade in, and the list slides to its new height. */
function CommandList({
  className,
  grows,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List> & { grows?: boolean }) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto",
        grows && "h-[min(var(--cmdk-list-height),300px)] transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none motion-safe:[&_[cmdk-group-heading]]:animate-in motion-safe:[&_[cmdk-group-heading]]:fade-in-0 motion-safe:[&_[cmdk-item]]:animate-in motion-safe:[&_[cmdk-item]]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-sm"
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
