"use client"

import React from "react"
import { KeywordExpansionPage } from "@/components/keyword-expansion-page"
import { useSearchOptional } from "@/lib/search"
import { useRouter } from "next/navigation"

export default function KeywordExpansionResultsPage({ params }: { params: Promise<{ searchId: string }> }) {
  const router = useRouter()
  const search = useSearchOptional()
  const currentQuery = search?.originalQuery || ''
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

  return (
    <KeywordExpansionPage 
      initialSuggestedQuery={currentQuery}
      showBackButton={true}
      onBack={handleBack}
    />
  )
} 