import { redirect } from "next/navigation";

/** The short address people guess for the Communities page. */
export default function CommunitiesAddress() {
  redirect("/evidence-communities");
}
