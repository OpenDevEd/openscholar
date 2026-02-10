"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps, toast } from "sonner"
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Loader2,
  Settings,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

// Gradient bar component matching filter sidebar design
function ToastGradientBar({ 
  from, 
  via, 
  to 
}: { 
  from: string
  via: string
  to: string
}) {
  return (
    <div 
      className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] rounded-r-sm"
      style={{
        background: `linear-gradient(180deg, ${from} 0%, ${via} 50%, ${to} 100%)`
      }}
    />
  )
}

// Toast type configurations
const toastTypes = {
  success: {
    icon: CheckCircle2,
    iconColor: "text-[oklch(0.58_0.16_140)]",
    gradient: { from: "oklch(0.7 0.15 145)", via: "oklch(0.65 0.18 145)", to: "oklch(0.58 0.16 140)" },
    bg: "bg-[oklch(0.95_0.03_140/0.8)]",
    border: "border-[oklch(0.85_0.06_140/0.5)]",
    darkBg: "dark:bg-[oklch(0.22_0.03_140/0.9)]",
    darkBorder: "dark:border-[oklch(0.35_0.06_140/0.5)]",
  },
  error: {
    icon: AlertCircle,
    iconColor: "text-[oklch(0.58_0.22_27)]",
    gradient: { from: "oklch(0.65 0.2 25)", via: "oklch(0.58 0.22 27)", to: "oklch(0.52 0.2 30)" },
    bg: "bg-[oklch(0.96_0.02_25/0.8)]",
    border: "border-[oklch(0.85_0.08_25/0.5)]",
    darkBg: "dark:bg-[oklch(0.22_0.02_25/0.9)]",
    darkBorder: "dark:border-[oklch(0.35_0.08_25/0.5)]",
  },
  warning: {
    icon: AlertTriangle,
    iconColor: "text-[oklch(0.72_0.18_80)]",
    gradient: { from: "oklch(0.78 0.16 85)", via: "oklch(0.72 0.18 80)", to: "oklch(0.65 0.16 75)" },
    bg: "bg-[oklch(0.97_0.03_80/0.8)]",
    border: "border-[oklch(0.88_0.08_80/0.5)]",
    darkBg: "dark:bg-[oklch(0.24_0.03_80/0.9)]",
    darkBorder: "dark:border-[oklch(0.38_0.08_80/0.5)]",
  },
  info: {
    icon: Info,
    iconColor: "text-[oklch(0.65_0.14_245)]",
    gradient: { from: "oklch(0.7 0.12 240)", via: "oklch(0.65 0.14 245)", to: "oklch(0.58 0.12 250)" },
    bg: "bg-[oklch(0.95_0.02_245/0.8)]",
    border: "border-[oklch(0.85_0.06_245/0.5)]",
    darkBg: "dark:bg-[oklch(0.22_0.02_245/0.9)]",
    darkBorder: "dark:border-[oklch(0.35_0.06_245/0.5)]",
  },
  loading: {
    icon: Loader2,
    iconColor: "text-[oklch(0.7_0.17_54)]",
    gradient: { from: "oklch(0.75 0.15 55)", via: "oklch(0.7 0.17 54)", to: "oklch(0.62 0.16 52)" },
    bg: "bg-[oklch(0.94_0.03_55/0.8)]",
    border: "border-[oklch(0.9_0.005_60/0.6)]",
    darkBg: "dark:bg-[oklch(0.24_0.02_55/0.9)]",
    darkBorder: "dark:border-[oklch(0.3_0.012_55/0.6)]",
  },
  default: {
    icon: Info,
    iconColor: "text-[oklch(0.7_0.17_54)]",
    gradient: { from: "oklch(0.75 0.15 55)", via: "oklch(0.7 0.17 54)", to: "oklch(0.62 0.16 52)" },
    bg: "bg-[oklch(0.94_0.03_55/0.8)]",
    border: "border-[oklch(0.9_0.005_60/0.6)]",
    darkBg: "dark:bg-[oklch(0.24_0.02_55/0.9)]",
    darkBorder: "dark:border-[oklch(0.3_0.012_55/0.6)]",
  },
}

// Custom toast component with gradient bar
function CustomToast({ 
  type, 
  title, 
  description, 
  action,
  closeToast 
}: { 
  type: keyof typeof toastTypes
  title: string
  description?: string
  action?: { label: string; onClick: () => void; icon?: "settings" | "arrow-right" }
  closeToast: () => void
}) {
  const config = toastTypes[type]
  const Icon = config.icon
  
  const ActionIcon = action?.icon === "settings" ? Settings : ArrowRight
  
  return (
    <div className={cn(
      "relative flex items-start gap-3 p-3 pl-5 rounded-xl border overflow-hidden",
      "min-w-[300px] max-w-[400px] transition-all duration-200 ease-out shadow-md",
      "hover:shadow-lg",
      config.bg,
      config.border,
      config.darkBg,
      config.darkBorder
    )}>
      {/* Left gradient bar - matches filter sidebar exactly */}
      <ToastGradientBar {...config.gradient} />
      
      {/* Icon */}
      <Icon className={cn("shrink-0 mt-0.5 h-4 w-4", config.iconColor, type === "loading" && "animate-spin")} />
      
      {/* Content */}
      <div className="flex flex-col gap-1 flex-1 min-w-0 pr-6">
        <span className="text-sm font-medium leading-tight text-foreground">
          {title}
        </span>
        {description && (
          <span className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        )}
        {action && (
          <button
            onClick={() => {
              action.onClick()
              closeToast()
            }}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 mt-1.5",
              "h-7 px-3 text-xs font-medium",
              "rounded-md",
              "bg-primary text-primary-foreground",
              "hover:bg-[oklch(0.62_0.16_52)]",
              "transition-all duration-150",
              "cursor-pointer border-0",
              "focus-visible:outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "w-fit"
            )}
          >
            <ActionIcon className="h-3 w-3" />
            {action.label}
          </button>
        )}
      </div>
      
      {/* Close button - appears on hover */}
      <button
        onClick={closeToast}
        className={cn(
          "absolute top-2 right-2 flex items-center justify-center w-6 h-6 p-0 rounded-md",
          "bg-transparent text-muted-foreground opacity-0 scale-90",
          "transition-all duration-150 cursor-pointer border-0",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:opacity-100 focus-visible:scale-100 focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "group-hover:opacity-100 group-hover:scale-100"
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// Wrapper functions to create custom styled toasts
function showStyledToast(
  type: keyof typeof toastTypes,
  title: string,
  options?: { description?: string; duration?: number; action?: { label: string; onClick: () => void; icon?: "settings" | "arrow-right" } }
) {
  return toast.custom(
    (t) => (
      <CustomToast
        type={type}
        title={title}
        description={options?.description}
        action={options?.action}
        closeToast={() => toast.dismiss(t)}
      />
    ),
    { duration: options?.duration ?? 4000 }
  )
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      visibleToasts={4}
      expand={true}
      {...props}
    />
  )
}

export { Toaster }
export { showStyledToast }

// Re-export sonner's toast methods with proper typing
export const customToast: typeof toast.custom = (...args) => toast.custom(...args)
export const dismissToast: typeof toast.dismiss = (...args) => toast.dismiss(...args)
