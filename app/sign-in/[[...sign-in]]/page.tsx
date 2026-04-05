"use client";

import { useSearchParams } from "next/navigation";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect_url");

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <SignIn
        fallbackRedirectUrl={redirectUrl || "/"}
        signUpFallbackRedirectUrl={redirectUrl || "/"}
      />
    </div>
  );
}
