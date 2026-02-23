import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageWrapper } from "@/components/PageWrapper";
import { MarkdownContent } from "@/components/markdown-content";

interface PolicyPageProps {
  content: string;
  otherPolicyLink: { href: string; label: string };
}

export async function PolicyPage({ content, otherPolicyLink }: PolicyPageProps) {
  const t = await getTranslations("legal");

  return (
    <PageWrapper>
      <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 max-w-3xl">
        <MarkdownContent content={content} />

        <div className="mt-8 pt-6 border-t border-border flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link
            href="/"
            className="text-sm font-medium text-primary hover:underline"
          >
            {t("backToSite")}
          </Link>
          <Link
            href={otherPolicyLink.href}
            className="text-sm font-medium text-primary hover:underline"
          >
            {otherPolicyLink.label}
          </Link>
        </div>
      </div>
    </PageWrapper>
  );
}
