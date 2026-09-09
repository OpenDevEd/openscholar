import { cn } from "@/lib/utils";
// Official assets from LinkedIn's brand downloads and orcid.org.
export function LinkedInIcon({ className }: { className?: string }) {
  return (
    <img
      src="/brands/linkedin.png"
      alt=""
      aria-hidden="true"
      className={cn("inline-block size-4 shrink-0 object-contain", className)}
    />
  );
}
export function OrcidIcon({ className }: { className?: string }) {
  return (
    <img
      src="/brands/orcid.png"
      alt=""
      aria-hidden="true"
      className={cn("inline-block size-4 shrink-0 object-contain", className)}
    />
  );
}
