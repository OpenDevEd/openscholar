import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalHeaderProps {
  icon: LucideIcon;
  iconBg?: string;
  badgeIcon?: LucideIcon;
  badgeColor?: string;
  title: string;
  description: string;
  className?: string;
}

export function ModalHeader({
  icon: Icon,
  iconBg = "bg-slate-100 dark:bg-slate-800",
  badgeIcon: BadgeIcon,
  badgeColor = "bg-blue-500",
  title,
  description,
  className = ""
}: ModalHeaderProps) {
  return (
    <DialogHeader className={cn("flex-shrink-0 border-b pb-6", className)}>
      <div className="flex items-start gap-4">
        <div className="relative">
          <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", iconBg)}>
            <Icon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </div>
          {BadgeIcon && (
            <div className={cn("absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center", badgeColor)}>
              <BadgeIcon className="h-2.5 w-2.5 text-white" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <DialogTitle className="text-lg font-semibold text-foreground mb-1">
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </DialogDescription>
        </div>
      </div>
    </DialogHeader>
  );
} 