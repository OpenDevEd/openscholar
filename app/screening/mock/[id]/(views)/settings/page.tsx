import { ScreeningForm } from "@/components/screening-mock/screening-form";

// Mock (mock/screening-reviewers): a running or finished screening's settings, with placeholder data.
export default async function ScreeningSettingsMockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScreeningForm key={id} id={id} />;
}
