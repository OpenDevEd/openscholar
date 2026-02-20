import { Metadata } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import { PolicyPage } from "@/components/policy-page";

export const metadata: Metadata = {
  title: "Cookie Policy | OpenScholar",
  description:
    "Learn how OpenScholar.ai uses cookies for analytics and how to manage your cookie preferences.",
};

const markdownContent = readFileSync(
  join(process.cwd(), "content/cookie-policy.md"),
  "utf-8"
);

export default function CookiePolicyPage() {
  return (
    <PolicyPage
      content={markdownContent}
      otherPolicyLink={{ href: "/privacy", label: "Privacy policy" }}
    />
  );
}
