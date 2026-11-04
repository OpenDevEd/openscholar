import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Home, Search } from "@/components/icons";
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("errors");
  return { title: t("pageNotFound") };
}

// The same card as the error page.
export default async function NotFound() {
  const t = await getTranslations("errors");

  return (
    <div className="container mx-auto flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center">
        <p className="mb-2 text-4xl font-semibold tabular-nums text-muted-foreground">{t("notFoundCode")}</p>
        <h1 className="mb-2 text-2xl font-semibold">{t("pageNotFound")}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t("pageNotFoundDescription")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/">
              <Home />
              {t("backToHome")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/results">
              <Search />
              {t("searchPapers")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
