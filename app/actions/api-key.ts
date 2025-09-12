"use server";

const IS_DEMO = process.env.IS_DEMO === "true";

export async function getAPIConfig() {
  if (IS_DEMO) {
    const demoApiKey = process.env.GEMINI_API_KEY;
    if (!demoApiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required for demo mode");
    }

    return {
      provider: 'google' as const,
      apiKey: demoApiKey,
      isDemo: true
    };
  }

  return {
    provider: null,
    apiKey: null,
    isDemo: false
  };
}