"use client"

import React from "react"
import { AIEnhancementPage } from "@/components/ai-enhancement-page"
import { useResultsStore, useNavbarStore, useKeywordExpansionDialogStore } from "@/lib/store"
import { useRouter } from "next/navigation"
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation"

export default function AIEnhancementResultsPage({ params }: { params: Promise<{ searchId: string }> }) {
  const router = useRouter()
  const { currentQuery } = useResultsStore()
  const { setQuery } = useNavbarStore()
  const { setSuggestedQuery } = useKeywordExpansionDialogStore()
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
    // Update the navbar query
    setQuery(newQuery)
    // Also update the suggested query (like useQueryChangeHandler does)
    const { expandedQuery } = validateAndExpandKeywordsSilently(newQuery)
    setSuggestedQuery(expandedQuery)
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