import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Home, LogIn } from "@/components/icons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publishReports.privateFile");
  return { title: t("title"), robots: { index: false } };
}

/**
 * Where a report's file that isn't out yet sends anyone it won't open (app/api/reports/files): a colleague sent the
 * link met a sign-in page with nothing said, and couldn't tell whether an account would help. Signed out, it offers
 * sign-in back to the file, for its owner; signed in, it says this account can't open it. The same card as not-found.
 */
export default async function PrivateFile({ searchParams }: { searchParams: Promise<{ file?: string }> }) {
  const t = await getTranslations("publishReports.privateFile");
  const tErrors = await getTranslations("errors");
  const { file } = await searchParams;
  const back = file && /^\/api\/reports\/files\/R\d{6,}(\?[\w=&%.-]*)?$/.test(file) ? file : null;
  const { userId } = await auth();
  return (
    <div className="container mx-auto flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="mb-2 text-2xl font-semibold">{t("title")}</h1>
        <p className="mb-6 text-sm text-pretty text-muted-foreground">{t(userId ? "signedIn" : "signedOut")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {!userId && back ? (
            <Button asChild>
              <Link href={`/sign-in?redirect_url=${encodeURIComponent(back)}`}>
                <LogIn />
                {t("signIn")}
              </Link>
            </Button>
          ) : null}
          <Button variant={!userId && back ? "outline" : "default"} asChild>
            <Link href="/">
              <Home />
              {tErrors("backToHome")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
