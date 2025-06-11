import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { AIConfigDialog } from "./ai-config-dialog";
import { useAIEnhanceStore } from "@/lib/store";

interface AIEnhanceButtonProps {
  query: string;
  onQueryChange: (query: string) => void;
  className?: string;
  [key: string]: any; // Allow data attributes
}

export function AIEnhanceButton({
  query,
  onQueryChange,
  className,
  ...props
}: AIEnhanceButtonProps) {
  const { isDialogOpen, setIsDialogOpen } = useAIEnhanceStore();

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className={className}
        onClick={() => setIsDialogOpen(true)}
        title="AI Query Enhancement"
        type="button"
        {...props}
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