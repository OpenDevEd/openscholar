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
/** ROR's own mark (github.com/ror-community/ror-logos), its letters lightened on a dark page. */
export function RorIcon({ className }: { className?: string }) {
  return (
    <>
      <img src="/brands/ror.svg" alt="" aria-hidden="true" className={cn("inline-block h-3 w-auto shrink-0 dark:hidden", className)} />
      <img src="/brands/ror-dark.svg" alt="" aria-hidden="true" className={cn("hidden h-3 w-auto shrink-0 dark:inline-block", className)} />
    </>
  );
}
