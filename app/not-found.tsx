import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { Home, Search } from "@/components/icons";
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations("errors");
  const tc = await getTranslations("common");

  return (
    <div className="flex flex-col items-center justify-center p-4 py-20 bg-background">
      <div className="text-center space-y-6 max-w-md">
        <Logo size="lg" className="justify-center" />

        <div className="space-y-2">
          <h1 className="text-4xl font-bold">{t("notFoundCode")}</h1>
          <h2 className="text-xl font-semibold text-muted-foreground">{t("pageNotFound")}</h2>
          <p className="text-muted-foreground">
            {t("pageNotFoundDescription")}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild>
            <Link href="/">
              <Home className="h-4 w-4 mr-2" />
              {t("backToHome")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/results">
              <Search className="h-4 w-4 mr-2" />
              {t("searchPapers")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
