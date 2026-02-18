"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
          <section style={{ maxWidth: 540, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
            <h1 style={{ marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ marginBottom: 16, color: "#666" }}>An unexpected error occurred.</p>
            <button
              onClick={() => reset()}
              style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}
            >
              Retry
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
