"use client";

import { Settings2 } from "lucide-react";

export default function GeneralSettingsPage() {
  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border/40">
        <h2 className="text-lg font-semibold tracking-tight">
          General Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Manage your general application preferences
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <h3 className="text-2xl font-bold tracking-tight mb-3 text-muted-foreground">
            Coming Soon
          </h3>
        </div>
      </div>
    </div>
  );
}
