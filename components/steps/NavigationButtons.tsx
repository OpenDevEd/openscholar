"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft } from "lucide-react";

interface NavigationButtonsProps {
  onBack?: () => void;
  onContinue?: () => void;
  continueText?: string;
  backText?: string;
  continueDisabled?: boolean;
  showBack?: boolean;
  isLoading?: boolean;
}

export function NavigationButtons({
  onBack,
  onContinue,
  continueText = "Continue",
  backText = "Back",
  continueDisabled = false,
  showBack = true,
  isLoading = false
}: NavigationButtonsProps) {
  return (
    <div className="flex justify-between w-full">
      {showBack && onBack ? (
        <Button variant="outline" onClick={onBack} className="px-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {backText}
        </Button>
      ) : (
        <div /> // Empty div to maintain spacing
      )}
      {onContinue ? (
        <Button
          onClick={onContinue}
          disabled={continueDisabled || isLoading}
          className="px-8 py-3 text-base font-medium"
          size="lg"
        >
          {continueText}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      ) : (
        <div /> // Empty div to maintain spacing
      )}
    </div>
  );
}
