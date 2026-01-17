import { Pricing } from "@/components/Pricing";
import { PageWrapper } from "@/components/PageWrapper";
import { Metadata } from "next";
import Stripe from "stripe";

export const metadata: Metadata = {
  title: "Pricing | OpenScholar",
  description: "Simple, transparent pricing for teams of all sizes.",
};

const PLAN_IDS = {
  go: "price_1SqNyJHXajH1NDoWsIPm9mCw",
  pro: "price_1SqNyhHXajH1NDoWzHFCV3xM",
};

export default async function PricingPage() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-12-15.clover",
  });

  const prices = await Promise.all(
    Object.values(PLAN_IDS).map(async (id) => {
      try {
        const price = await stripe.prices.retrieve(id);
        return {
          id: price.id,
          amount: price.unit_amount,
          currency: price.currency,
          interval: price.recurring?.interval,
          nickname: price.nickname,
          metadata: price.metadata,
        };
      } catch (error) {
        console.error(`Failed to fetch price ${id}:`, error);
        return null;
      }
    }),
  );

  const validPrices = prices.filter((p) => p !== null);

  return (
    <PageWrapper>
      <Pricing initialPrices={validPrices} />
    </PageWrapper>
  );
}
