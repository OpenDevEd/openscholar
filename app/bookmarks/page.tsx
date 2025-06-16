import { KeywordExpansionPage } from "@/components/keyword-expansion-page"
import { Metadata } from "next"
import { Suspense } from "react"

export const metadata: Metadata = {
  title: "Bookmarks | OpenScholar",
  description: "Manage your bookmarks for faster, more efficient searches.",
}

function KeywordExpansionFallback() {
  return (
    <div className="container mx-auto p-6">
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
          <div className="space-y-6">
            <div className="h-32 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function KeywordExpansionRootPage() {
  return (
    <Suspense fallback={<KeywordExpansionFallback />}>
      <KeywordExpansionPage 
        showBackButton={true}
      />
    </Suspense>
  )
} 