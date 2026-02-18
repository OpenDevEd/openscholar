"use client";

export function AmbientBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Primary Orb */}
      <div
        className="absolute w-[400px] h-[400px] sm:w-[800px] sm:h-[800px] rounded-full blur-[120px] opacity-20 dark:opacity-10 -translate-x-1/2 -translate-y-1/2"
        style={{
          background:
            "radial-gradient(circle, var(--primary) 0%, transparent 70%)",
          left: "50%",
          top: "30%",
        }}
      />

      {/* Secondary Orb */}
      <div
        className="absolute w-[300px] h-[300px] sm:w-[600px] sm:h-[600px] rounded-full blur-[100px] opacity-15 dark:opacity-10"
        style={{
          background:
            "radial-gradient(circle, var(--secondary) 0%, transparent 70%)",
          right: "-10%",
          bottom: "-10%",
        }}
      />

      {/* Grid Pattern Overlay */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
        style={{
          backgroundImage: `linear-gradient(to right, var(--foreground) 1px, transparent 1px),
                           linear-gradient(to bottom, var(--foreground) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
          maskImage:
            "radial-gradient(circle at center, black 40%, transparent 100%)",
        }}
      />
    </div>
  );
}
