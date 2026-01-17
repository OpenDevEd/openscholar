import { redirect } from "next/navigation";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";

export default async function SignInPage() {
  const signInUrl = await getSignInUrl();
  redirect(signInUrl);
}
