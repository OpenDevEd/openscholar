import { cn } from "@/lib/utils";

interface ConfidenceRingProps {
  value: number;
  size?: number;
  className?: string;
}

export function ConfidenceRing({ value, size = 48, className }: ConfidenceRingProps) {
  const percentage = Math.round(value * 100);
  const radius = (size / 2) - 4;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value * circumference);

  const color =
    value >= 0.8 ? 'text-green-500' :
    value >= 0.5 ? 'text-yellow-500' :
    'text-red-500';

  return (
    <div className={cn("relative", className)} style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="fill-none stroke-muted"
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={cn("fill-none transition-all duration-300", color)}
          strokeWidth={4}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn("text-xs font-bold", color)}>
          {percentage}%
        </span>
      </div>
    </div>
  );
}
