"use client";

// MOCK (#1237): stands in for Zenodo's own sign-in and approval page, which a real connection goes through (OAuth).
// Allow connects the person's Zenodo account in this browser and sends them back where they came from.

import { ZenodoMark } from "@/components/icons/zenodo-mark";
import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { parseAsString, useQueryState } from "nuqs";
import { Check, FlaskConical } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { setZenodoAccount } from "@/lib/mock/zenodo-account";

export default function ZenodoConnectMock() {
  const { user } = useUser();
  const [back] = useQueryState("back", parseAsString.withDefault("/settings/connections"));
  const [leaving, setLeaving] = useState(false);
  // Only a path on this site is gone back to.
  const home = back.startsWith("/") && !back.startsWith("//") ? back : "/settings/connections";
  const name = user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "";
  const go = (allow: boolean) => {
    setLeaving(true);
    if (allow) setZenodoAccount({ name, connectedAt: Date.now() });
    // Opened in a window of its own, the page that opened it hears the connection and stays as it was.
    if (window.opener) window.close();
    else window.location.assign(home);
  };
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-inset px-4 py-10">
      <p className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm">
        <FlaskConical className="size-3.5" /> Stand-in for Zenodo&apos;s own page
      </p>
      <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-background p-6 shadow-sm">
        <div className="flex items-center justify-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl border border-border-subtle">
            <LogoMark className="size-6" />
          </span>
          <span className="h-px w-6 bg-border" />
          <ZenodoMark className="size-11 rounded-xl" />
        </div>
        <h1 className="mt-5 text-center text-base font-semibold text-balance">Openscholar wants to use your Zenodo account</h1>
        <ul className="mt-4 space-y-2 text-sm">
          {["Create records and upload their files", "Publish the records it creates"].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">Signed in to Zenodo as {name}</p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={leaving} onClick={() => go(false)}>
            Cancel
          </Button>
          <Button disabled={leaving || !name} onClick={() => go(true)}>
            Allow
          </Button>
        </div>
      </div>
    </main>
  );
}
