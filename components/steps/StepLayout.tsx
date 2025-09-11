"use client";

import { ReactNode } from "react";
import { motion } from "motion/react";

interface StepLayoutProps {
  children: ReactNode;
  className?: string;
}

export function StepLayout({ children, className = "" }: StepLayoutProps) {
  return (
    <motion.main
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className={`w-full min-h-screen bg-gradient-to-br from-background via-background to-muted/20 ${className}`}
    >
      <div className="container max-w-4xl mx-auto px-4 py-8 md:py-16">
        {children}
      </div>
    </motion.main>
  );
}
