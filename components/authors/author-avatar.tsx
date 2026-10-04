import { UserRound } from "@/components/icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function AuthorAvatar({ photo, className }: { photo?: string | null; className?: string }) {
  return <Avatar className={cn("shrink-0 rounded-xl", className)}>
    <AvatarImage src={photo || undefined} alt="" className="object-cover" />
    <AvatarFallback className="rounded-[inherit] bg-inset text-muted-foreground">
      <UserRound aria-hidden className="size-1/2" />
    </AvatarFallback>
  </Avatar>;
}
