import { Pricing } from "@/components/Pricing";
import { PageWrapper } from "@/components/PageWrapper";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing | OpenScholar",
  description: "Simple, transparent pricing for teams of all sizes.",
};

export default function PricingPage() {
  return (
    <PageWrapper>
      <Pricing initialPrices={[]} />
    </PageWrapper>
  );
}
