import { BookmarksCommandCenter } from "@/components/bookmarks-command-center"
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

function BookmarksFallback() {
  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
      <div className="animate-pulse">
        <div className="rounded-2xl border border-border/50 bg-background/80 overflow-hidden">
          {/* Header skeleton */}
          <div className="px-6 py-5 border-b border-border/40">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-muted"></div>
              <div className="space-y-2">
                <div className="h-6 w-32 bg-muted rounded"></div>
                <div className="h-4 w-48 bg-muted rounded"></div>
              </div>
            </div>
          </div>
          {/* Toolbar skeleton */}
          <div className="px-6 py-3 border-b border-border/40">
            <div className="flex items-center gap-4">
              <div className="h-9 w-32 bg-muted rounded-lg"></div>
              <div className="flex-1 h-9 bg-muted rounded-lg"></div>
              <div className="h-9 w-24 bg-muted rounded-lg"></div>
            </div>
          </div>
          {/* List skeleton */}
          <div className="p-6 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-muted rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BookmarksPage() {
  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <Suspense fallback={<BookmarksFallback />}>
          <BookmarksCommandCenter />
        </Suspense>
      </div>
    </PageWrapper>
  )
}
