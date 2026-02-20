import Link from "next/link";

const linkClassName = "text-primary underline-offset-4 hover:underline font-medium";

export function PolicyLinks({ className }: { className?: string }) {
  return (
    <p className={className}>
      Learn more in our{" "}
      <Link href="/privacy" className={linkClassName}>
        Privacy policy
      </Link>
      {" and "}
      <Link href="/cookie-policy" className={linkClassName}>
        Cookie policy
      </Link>
    </p>
  );
}
