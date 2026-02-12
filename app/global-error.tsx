"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPages");
  const tc = useTranslations("common");

  useEffect(() => {
    console.error("[app/global-error]", error);
  }, [error]);

  return (
    <html>
      <body>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
          <section style={{ maxWidth: 540, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
            <h1 style={{ marginBottom: 8 }}>{t("somethingWentWrong")}</h1>
            <p style={{ marginBottom: 16, color: "#666" }}>{t("unexpectedError")}</p>
            <button
              onClick={() => reset()}
              style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}
            >
              {tc("retry")}
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
