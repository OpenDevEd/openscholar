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
      className={cn("inline-block rounded-sm border border-gray-200", className)}
      width="16"
      height="12"
    />
  );
}; 