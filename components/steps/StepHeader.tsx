"use client";

interface StepHeaderProps {
  stepNumber: number;
  totalSteps: number;
  title: string;
  description: string;
}

export function StepHeader({ stepNumber, totalSteps, title, description }: StepHeaderProps) {
  return (
    <div className="text-center mb-8 md:mb-12">
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-4">
        <span className="text-sm font-medium text-primary">
          Step {stepNumber} of {totalSteps}
        </span>
      </div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
        {title}
      </h1>
      <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
        {description}
      </p>
    </div>
  );
}
