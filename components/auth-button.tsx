"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface AuthButtonProps {
  isCollapsed?: boolean;
}

export function AuthButton({ isCollapsed = false }: AuthButtonProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Loading state
  if (loading) {
    return (
      <Button 
        variant="ghost" 
        size="sm" 
        className={cn(
          "transition-all duration-200",
          isCollapsed ? "h-8 w-8 px-0" : "flex-1 justify-start px-2 h-9 gap-2"
        )}
        disabled
      >
        <User className="h-[1.2rem] w-[1.2rem] animate-pulse" />
        {!isCollapsed && <span className="text-sm font-medium">Loading...</span>}
        <span className="sr-only">Loading...</span>
      </Button>
    );
  }

  // Not signed in
  if (!user) {
    const button = (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "transition-all duration-200 hover:bg-sidebar-accent/80",
          isCollapsed ? "h-8 w-8 px-0" : "flex-1 justify-start px-2 h-9 gap-2"
        )}
        onClick={() => router.push("/auth/signin")}
        title={isCollapsed ? undefined : "Sign In"}
      >
        <LogIn className="h-[1.2rem] w-[1.2rem] shrink-0" />
        {!isCollapsed && <span className="text-sm font-medium">Sign In</span>}
        <span className="sr-only">Sign In</span>
      </Button>
    );

    if (isCollapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            {button}
          </TooltipTrigger>
          <TooltipContent side="right">
            Sign In
          </TooltipContent>
        </Tooltip>
      );
    }

    return button;
  }

  // Signed in - get display info
  const displayName = user.firstName 
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : user.email?.split("@")[0] || "User";
    
  const initials = user.firstName && user.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user.firstName
    ? user.firstName[0]
    : user.email?.[0]?.toUpperCase() || "U";

  const trigger = (
    <Button 
      variant="ghost" 
      size="sm" 
      className={cn(
        "transition-all duration-200 hover:bg-sidebar-accent/80",
        isCollapsed ? "h-8 w-8 px-0" : "flex-1 justify-start px-2 h-9 gap-2"
      )}
    >
      <User className="h-[1.2rem] w-[1.2rem] shrink-0" />
      {!isCollapsed && <span className="truncate text-sm font-medium">{displayName}</span>}
      <span className="sr-only">{displayName}</span>
    </Button>
  );

  return (
    <DropdownMenu>
      {isCollapsed ? (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              {trigger}
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">
            {displayName}
          </TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>
          {trigger}
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent side={isCollapsed ? "right" : "top"} align="start" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarImage src={user.profilePictureUrl || undefined} alt={displayName} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{displayName}</p>
              <p className="text-xs leading-none text-muted-foreground truncate max-w-[160px]">
                {user.email}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/auth/signout")} className="text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
