"use client";

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Enter } from "@/components/settings/parts";

/** Admin pages exist only for admins; everyone else gets the not-found page. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { data: isAdmin } = useProtectedQuery(api.admins.queries.amI, {});
  if (isAdmin === false) notFound();
  if (isAdmin === undefined) return <Enter ready={false}>{null}</Enter>;
  return children;
}
