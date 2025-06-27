"use client"

import React from "react"
import { AIEnhancementPage } from "@/components/ai-enhancement-page"

import { useRouter } from "next/navigation"

export default function AIEnhancementResultsPage({ params }: { params: Promise<{ searchId: string }> }) {
  const router = useRouter()
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
    <AIEnhancementPage 
      showBackButton={true}
      onBack={handleBack}
    />
  )
} 