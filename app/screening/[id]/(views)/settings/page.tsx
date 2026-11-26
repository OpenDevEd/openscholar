import { ScreeningForm } from "@/components/screening-mock/screening-form";

// A running or finished screening's settings.
export default async function ScreeningSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScreeningForm key={id} id={id} />;
}
