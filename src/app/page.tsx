import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/server/session";

export default async function IndexPage() {
  redirect((await getCurrentSession()) ? "/home" : "/sign-in");
}
