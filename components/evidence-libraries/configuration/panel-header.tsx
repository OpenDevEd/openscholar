"use client";

import { ChevronLeft, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LibraryImage } from "../library-image";

/**
 * Same look as `CommandCenterHeader` (icon tile, title, description) but with a
 * free right-hand slot for actions instead of the fixed count pill.
 */
const TILE =
  "flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 shadow-sm md:h-12 md:w-12";

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className={TILE}>
      <Icon className="h-5 w-5 text-primary md:h-6 md:w-6" />
    </div>
  );
}

export function PanelHeader({
  icon: Icon,
  image,
  title,
  description,
  backHref,
  backLabel,
  titleAside,
  children,
  className,
}: {
  icon: LucideIcon;
  /** A library page: its favicon, or null for the OpenScholar one. Leave undefined for the icon. */
  image?: string | null;
  title: ReactNode;
  /** One line under the title: what the page is about, or the library's address link. */
  description?: ReactNode;
  /** Where the back chevron goes. */
  backHref?: string;
  backLabel?: string;
  /** Small chip shown next to the title, such as a state. */
  titleAside?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative px-4 md:px-6 py-5 border-b border-border/40", className)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 md:gap-4">
          {backHref ? (
            <Button asChild variant="ghost" size="icon" className="-ml-2 shrink-0 text-muted-foreground">
              <Link href={backHref} aria-label={backLabel}>
                <ChevronLeft className="h-5 w-5" />
              </Link>
            </Button>
          ) : null}
          <div className="relative shrink-0">
            {image !== undefined ? (
              <LibraryImage
                src={image ?? "/icon.svg"}
                className={TILE}
                // The owner's icon fills the tile and takes its rounded corners.
                imageClassName={image ? "size-full object-cover" : "h-6 w-6 object-contain md:h-7 md:w-7"}
                fallback={<IconTile icon={Icon} />}
              />
            ) : (
              <IconTile icon={Icon} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-foreground md:text-2xl">{title}</h1>
              {titleAside}
            </div>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {children ? (
          <div className="flex flex-wrap items-center gap-2">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
