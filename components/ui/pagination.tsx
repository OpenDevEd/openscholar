import * as React from "react"
import { useTranslations } from "next-intl"
import {
  ChevronLeftIcon,
  ChevronRightIcon
} from "@/components/icons"

import { cn } from "@/lib/utils"
import { buttonVariants, type Button } from "@/components/ui/button"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  const t = useTranslations("accessibility")
  return (
    <nav
      aria-label={t("pagination")}
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-1", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">

function PaginationLink({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? "page" : undefined}
      // Most lists page with a click and no address: it still takes the keyboard, unless it's disabled.
      role={props.href ? undefined : "link"}
      tabIndex={props.href || props["aria-disabled"] ? undefined : 0}
      onKeyDown={(event) => {
        if (!props.href && event.key === "Enter") event.currentTarget.click();
        props.onKeyDown?.(event);
      }}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(
        buttonVariants({
          variant: isActive ? "outline" : "ghost",
          size,
        }),
        className
      )}
      {...props}
    />
  )
}

function PaginationPrevious({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  const t = useTranslations("accessibility")
  const tc = useTranslations("common")
  return (
    <PaginationLink
      aria-label={t("goToPreviousPage")}
      size="default"
      className={cn("gap-1 px-2.5 sm:ps-2.5", className)}
      {...props}
    >
      <ChevronLeftIcon />
      <span className="hidden sm:block">{tc("previous")}</span>
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  const t = useTranslations("accessibility")
  const tc = useTranslations("common")
  return (
    <PaginationLink
      aria-label={t("goToNextPage")}
      size="default"
      className={cn("gap-1 px-2.5 sm:pe-2.5", className)}
      {...props}
    >
      <span className="hidden sm:block">{tc("next")}</span>
      <ChevronRightIcon />
    </PaginationLink>
  )
}

export { Pagination, PaginationContent, PaginationLink, PaginationItem, PaginationPrevious, PaginationNext };
