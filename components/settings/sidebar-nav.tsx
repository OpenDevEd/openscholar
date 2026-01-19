"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { buttonVariants } from "@/components/ui/button";

interface SidebarNavProps extends React.HTMLAttributes<HTMLElement> {
  items: {
    href: string;
    title: string;
    icon: React.ElementType;
  }[];
}

export function SidebarNav({ className, items, ...props }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        "flex space-x-2 md:flex-col md:space-x-0 md:space-y-1",
        className,
      )}
      {...props}
    >
      {items.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="relative group block"
          >
            <motion.div
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "w-full justify-start gap-3 relative overflow-hidden transition-all duration-200",
                isActive
                  ? "bg-sidebar-accent/80 text-sidebar-primary font-medium shadow-sm hover:bg-sidebar-accent/90"
                  : "hover:bg-sidebar-accent/40 text-muted-foreground hover:text-foreground"
              )}
              whileHover={{ x: 4 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            >
              {isActive && (
                 <motion.div
                  layoutId="activeNav"
                  className="absolute inset-0 bg-sidebar-accent/50 z-0"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              )}
              
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-gradient-to-b from-primary/80 to-primary/50 rounded-r-full" />
              )}

              <item.icon className={cn(
                "h-4 w-4 z-10 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
              )} />
              <span className="z-10 relative">{item.title}</span>
            </motion.div>
          </Link>
        );
      })}
    </nav>
  );
}
