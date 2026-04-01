"use client";

import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";

export function HomeHero() {
  const t = useTranslations("home");

  return (
    <div className="flex flex-col items-center text-center gap-4 mb-6 relative z-10 w-full max-w-4xl mx-auto px-4">
      {/* Win2000-style title bar window chrome */}
      <div
        className="w-full max-w-2xl"
        style={{ fontFamily: "'Tahoma', 'MS Sans Serif', Arial, sans-serif" }}
      >
        {/* Window title bar */}
        <div
          style={{
            background: "linear-gradient(180deg, #0a246a 0%, #3a6ea5 100%)",
            padding: "3px 4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #0a246a",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {/* Window icon placeholder */}
            <div
              style={{
                width: 16,
                height: 16,
                background: "linear-gradient(135deg, #4fc3f7 0%, #0288d1 100%)",
                borderRadius: 2,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <circle cx="5" cy="5" r="4" fill="white" opacity="0.8" />
                <circle cx="5" cy="4" r="1.5" fill="#0288d1" />
                <rect x="3.5" y="5.5" width="3" height="3" rx="0.5" fill="#0288d1" />
              </svg>
            </div>
            <span
              style={{
                color: "white",
                fontSize: "11px",
                fontWeight: "bold",
                letterSpacing: "0.01em",
              }}
            >
              OpenAlex Search — Microsoft Internet Explorer
            </span>
          </div>
          {/* Win buttons */}
          <div style={{ display: "flex", gap: "2px" }}>
            {["_", "□", "✕"].map((icon, i) => (
              <div
                key={i}
                style={{
                  width: 16,
                  height: 14,
                  background: i === 2 ? "#c0392b" : "#d4d0c8",
                  border: "1px solid",
                  borderColor: i === 2 ? "#e74c3c #8b1a1a #8b1a1a #e74c3c" : "#ffffff #808080 #808080 #ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "9px",
                  fontWeight: "bold",
                  color: i === 2 ? "white" : "#000",
                  cursor: "default",
                  userSelect: "none",
                }}
              >
                {icon}
              </div>
            ))}
          </div>
        </div>

        {/* Toolbar row */}
        <div
          style={{
            background: "#d4d0c8",
            borderBottom: "1px solid #808080",
            padding: "2px 4px",
            display: "flex",
            alignItems: "center",
            gap: "2px",
          }}
        >
          {["Back", "Forward", "Stop", "Refresh", "Home"].map((btn) => (
            <button
              key={btn}
              style={{
                background: "#d4d0c8",
                border: "1px solid",
                borderColor: "transparent",
                padding: "2px 6px",
                fontSize: "11px",
                fontFamily: "Tahoma, Arial, sans-serif",
                cursor: "default",
                color: "#000",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#ffffff #808080 #808080 #ffffff";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
              }}
            >
              {btn}
            </button>
          ))}
          <div
            style={{
              marginLeft: "8px",
              flex: 1,
              background: "white",
              border: "1px solid",
              borderColor: "#808080 #ffffff #ffffff #808080",
              padding: "1px 4px",
              fontSize: "11px",
              color: "#000",
              fontFamily: "Tahoma, Arial, sans-serif",
            }}
          >
            http://openalex.org/search/
          </div>
          <button
            style={{
              background: "#d4d0c8",
              border: "1px solid",
              borderColor: "#ffffff #808080 #808080 #ffffff",
              padding: "2px 8px",
              fontSize: "11px",
              fontFamily: "Tahoma, Arial, sans-serif",
              cursor: "default",
            }}
          >
            Go
          </button>
        </div>

        {/* Window content area */}
        <div
          style={{
            background: "#d4d0c8",
            padding: "16px 20px 12px",
            borderLeft: "2px solid #ffffff",
            borderRight: "2px solid #808080",
            borderBottom: "2px solid #808080",
          }}
        >
          {/* Logo area inside the "page" */}
          <div
            style={{
              background: "white",
              border: "1px solid",
              borderColor: "#808080 #ffffff #ffffff #808080",
              padding: "12px 16px",
              marginBottom: "8px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Logo size="xl" clickable={false} context="home" />
            <p
              style={{
                color: "#000080",
                fontSize: "13px",
                fontFamily: "Tahoma, Arial, sans-serif",
                margin: 0,
                textAlign: "center",
              }}
            >
              {t("tagline")}
            </p>
          </div>

          {/* Status bar */}
          <div
            style={{
              background: "#d4d0c8",
              borderTop: "1px solid #808080",
              padding: "2px 4px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "11px",
              fontFamily: "Tahoma, Arial, sans-serif",
            }}
          >
            <div
              style={{
                flex: 1,
                borderRight: "1px solid #808080",
                paddingRight: "8px",
              }}
            >
              Done
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
              <div
                style={{
                  width: 14,
                  height: 14,
                  background: "linear-gradient(135deg, #4fc3f7 0%, #0288d1 100%)",
                  borderRadius: "50%",
                }}
              />
              <span>Internet</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
