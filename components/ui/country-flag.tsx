import { cn } from "@/lib/utils";

interface CountryFlagProps {
  countryCode: string;
  className?: string;
}

export const CountryFlag = ({ countryCode, className = "" }: CountryFlagProps) => {
  const flagUrl = `https://flagcdn.com/w20/${countryCode.toLowerCase()}.png`;
  
  return (
    <img
      src={flagUrl}
      alt=""
      className={cn("inline-block h-3 w-4 rounded-[2px] border border-border bg-muted object-cover", className)}
      width="16"
      height="12"
    />
  );
}; 