import { ScreeningPage } from "@/components/screening/screening-page";
import { SubscriptionStateProvider } from "@/lib/auth/use-subscription-state";

// The form's model picker reads the person's plan the way the settings pages do.
export default function Page() {
  return (
    <SubscriptionStateProvider>
      <ScreeningPage />
    </SubscriptionStateProvider>
  );
}
