"use client";

import { Target } from "lucide-react";

interface ResearchQuestionDisplayProps {
  researchQuestion: string;
  fallbackQuestion?: string;
}

export function ResearchQuestionDisplay({
  researchQuestion,
  fallbackQuestion = "What are the impacts of social media on adolescent mental health?"
}: ResearchQuestionDisplayProps) {
  return (
    <div className="p-4 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/20">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/20 mt-0.5">
          <Target className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium mb-1 text-sm text-muted-foreground">Research Question</h3>
          <p className="text-foreground font-medium italic">
            "{researchQuestion || fallbackQuestion}"
          </p>
        </div>
      </div>
    </div>
  );
}
