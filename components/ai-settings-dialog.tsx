"use client"

import { useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ModalHeader } from "@/components/ui/modal-header"
import { AIConfig } from "@/components/ai-config"
import { Settings2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface AISettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AISettingsDialog({ open, onOpenChange }: AISettingsDialogProps) {
  const [view, setView] = useState<'config' | 'model-select'>('config')

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setView('config')
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden p-0">
        {/* {view === 'config' && (
          <ModalHeader
            icon={Settings2}
            iconBg="bg-purple-100 dark:bg-purple-900/50"
            title="AI Settings"
            description="Configure your AI provider, model, and API key for enhanced search queries."
          />
        )} */}
        <div className={cn(
          "flex-1 min-h-0 flex flex-col",
          " overflow-y-auto"
        )}>
          <AIConfig variant="plain" onViewChange={setView} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
