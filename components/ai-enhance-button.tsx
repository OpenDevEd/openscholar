import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { AIConfigDialog } from "./ai-config-dialog";

interface AIEnhanceButtonProps {
  query: string;
  onQueryChange: (query: string) => void;
  className?: string;
}

export function AIEnhanceButton({
  query,
  onQueryChange,
  className,
}: AIEnhanceButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className={className}
        onClick={() => setIsDialogOpen(true)}
        title="AI Query Enhancement"
        type="button"
      >
        <Sparkles className="h-4 w-4" />
      </Button>
      <AIConfigDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen}
        query={query}
        onQueryChange={onQueryChange}
      />
    </>
  );
} 