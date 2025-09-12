import { AIEnhancementPage } from "@/components/ai-enhancement-page"
import { Metadata } from "next"
import { Suspense } from "react"

export const metadata: Metadata = {
  title: "AI Enhancement | OpenScholar",
  description: "Enhance your search queries with AI-powered synonyms, operators, and semantic improvements.",
}

function AIEnhancementFallback() {
  return (
    <div className="container mx-auto p-6">
      <div className="animate-pulse">
        <div className="h-8 bg-muted rounded w-1/4 mb-4"></div>
        <div className="h-4 bg-muted rounded w-1/2 mb-8"></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="h-64 bg-muted rounded"></div>
          </div>
          <div className="space-y-6">
            <div className="h-32 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AIEnhancementRootPage() {
  return (
    <Suspense fallback={<AIEnhancementFallback />}>
      <AIEnhancementPage 
        showBackButton={true}
      />
    </Suspense>
  )
} 