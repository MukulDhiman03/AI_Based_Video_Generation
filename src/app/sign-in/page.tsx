import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/auth-frame";
import { AuthForm } from "@/components/auth/auth-form";
import { getCurrentSession } from "@/lib/server/session";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getCurrentSession()) redirect("/home");
  return (
    <AuthFrame>
      <AuthForm />
    </AuthFrame>
  );
}
