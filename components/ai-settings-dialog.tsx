"use client"

import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ModalHeader } from "@/components/ui/modal-header"
import { AIConfig } from "@/components/ai-config"
import { Sparkles } from "lucide-react"

interface AISettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AISettingsDialog({ open, onOpenChange }: AISettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <ModalHeader
          icon={Sparkles}
          iconBg="bg-purple-100 dark:bg-purple-900/50"
          title="AI Settings"
          description="Configure your AI provider, model, and API key for enhanced search queries."
        />
        <AIConfig variant="plain" />
      </DialogContent>
    </Dialog>
  )
}
