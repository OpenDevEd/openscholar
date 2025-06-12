"use client";

import { usePathname } from "next/navigation";
import { Footer } from "./footer";

export function ConditionalFooter() {
  const pathname = usePathname();
  
  // Hide footer on the home page (root path)
  if (pathname === '/') {
    return null;
  }
  
  return <Footer />;
} 