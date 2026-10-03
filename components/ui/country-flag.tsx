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
      alt={`${countryCode} flag`}
      className={cn("inline-block rounded-[2px] border border-border", className)}
      width="16"
      height="12"
    />
  );
}; 