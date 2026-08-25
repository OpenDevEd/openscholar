import { cn } from "@/lib/utils";

export function OrgAvatar({
  initials,
  color,
  className,
}: {
  initials: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white",
        className,
      )}
      style={{ background: color }}
    >
      {initials}
    </span>
  );
}
