"use client";

// The end of a Zenodo sign-in opened in a small window (#1237): the window closes, and the page that opened it has
// the account already. Opened on its own, it goes to Connections.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

export default function ZenodoDonePage() {
  const router = useRouter();
  // The browser window is the outside system: a window this sign-in opened closes itself.
  useEffect(() => {
    if (window.opener) window.close();
    else router.replace(`/settings/connections${window.location.search}`);
  }, [router]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status">
      <Spinner />
    </div>
  );
}
