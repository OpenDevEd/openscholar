"use client"

import React from "react"
import { AIEnhancementPage } from "@/components/ai-enhancement-page"
import { useResultsStore } from "@/lib/store"
import { useRouter } from "next/navigation"

export default function AIEnhancementResultsPage({ params }: { params: Promise<{ searchId: string }> }) {
  const router = useRouter()
  const { currentQuery, setCurrentQuery } = useResultsStore()
  const [searchId, setSearchId] = React.useState<string>("")

  React.useEffect(() => {
    const getSearchId = async () => {
      const resolvedParams = await params
      setSearchId(resolvedParams.searchId)
    }
    getSearchId()
  }, [params])

  const handleBack = () => {
    // Navigate back to specific search results
    router.push(`/results/${searchId}`)
  }

  const handleQueryChange = (newQuery: string) => {
    // Update the current query (setSuggestedQuery is now handled centrally by QuerySyncProvider)
    setCurrentQuery(newQuery)
  }

  return (
    <AIEnhancementPage 
      initialQuery={currentQuery}
      showBackButton={true}
      onBack={handleBack}
      onQueryChange={handleQueryChange}
    />
  )
} 