"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useAppToast } from "@/lib/toast";

export default function CleanupPage() {
  const toast = useAppToast();
  const ta = useTranslations("admin");
  const cleanupDuplicates = useMutation(api.subscriptions.mutations.cleanupDuplicateSubscriptions);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleCleanup = async () => {
    if (!confirm(ta("cleanupConfirm"))) {
      return;
    }

    try {
      setIsLoading(true);
      const res = await cleanupDuplicates({});
      setResult(res);
      toast.success(ta("cleanupSuccess", { count: res.cleaned }));
    } catch (error: any) {
      toast.error(error.message || ta("cleanupFailed"));
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">{ta("cleanupTitle")}</h1>

      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 mb-6">
        <p className="text-sm text-yellow-800 dark:text-yellow-200">
          {ta("cleanupDescription")}
        </p>
      </div>

      <Button onClick={handleCleanup} disabled={isLoading}>
        {isLoading ? ta("cleaningUp") : ta("runCleanup")}
      </Button>

      {result && (
        <div className="mt-6 p-4 bg-muted rounded-lg">
          <h2 className="font-semibold mb-2">{ta("result")}</h2>
          <pre className="text-sm">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
