import { Metadata } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import { PolicyPage } from "@/components/policy-page";

export const metadata: Metadata = {
  title: "Privacy Policy | OpenScholar",
  description:
    "OpenScholar.ai customer privacy notice. Learn how Open Development & Education collects, uses, and protects your personal information.",
};

const markdownContent = readFileSync(
  join(process.cwd(), "content/privacy-policy.md"),
  "utf-8"
);

export default function PrivacyPage() {
  return (
    <PolicyPage
      content={markdownContent}
      otherPolicyLink={{ href: "/cookie-policy", label: "Cookie policy" }}
    />
  );
}
