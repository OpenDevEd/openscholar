import { BookmarksCommandCenter, BookmarksLoading } from "@/components/bookmarks-command-center"
import { Metadata } from "next"
import { Suspense } from "react"
import { getTranslations } from "next-intl/server"
import { PageWrapper } from "@/components/PageWrapper"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("bookmarksTitle"),
    description: t("bookmarksDescription"),
  };
}

export default function BookmarksPage() {
  return (
    <PageWrapper>
      <Suspense fallback={<BookmarksLoading />}>
        <BookmarksCommandCenter />
      </Suspense>
    </PageWrapper>
  )
}
