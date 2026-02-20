import { redirect } from "next/navigation";
import { Pricing } from "@/components/Pricing";
import { PageWrapper } from "@/components/PageWrapper";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing | OpenScholar",
  description: "Simple, transparent pricing for teams of all sizes.",
};

export default function PricingPage() {
  if (process.env.NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED === "false") {
    redirect("/");
  }
  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <Pricing />
      </div>
    </PageWrapper>
  );
}
