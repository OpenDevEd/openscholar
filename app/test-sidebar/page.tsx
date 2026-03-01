"use client";

import { SidebarLayout } from "@/components/shared/sidebar-layout";

export default function TestSidebarPage() {
  return (
    <div className="h-screen">
      <SidebarLayout
        sidebar={
          <div className="p-4 space-y-4">
            <h2 className="text-lg font-semibold">Sidebar</h2>
            <p className="text-sm text-muted-foreground">
              This is the sidebar content. On desktop it appears as a left column.
              On mobile it appears under the Filters tab.
            </p>
          </div>
        }
      >
        <div className="p-4 space-y-4">
          <h1 className="text-2xl font-bold">Main Content</h1>
          <p className="text-muted-foreground">
            This is the main content area. On desktop it appears as the right column.
            On mobile it appears under the Results tab.
          </p>
        </div>
      </SidebarLayout>
    </div>
  );
}
