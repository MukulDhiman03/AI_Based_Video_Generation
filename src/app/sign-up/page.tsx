import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/auth-frame";
import { AuthForm } from "@/components/auth/auth-form";
import { getCurrentSession } from "@/lib/server/session";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Create your account",
  referrer: "no-referrer",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  if (await getCurrentSession()) redirect("/home");
  const { invite } = await searchParams;
  return (
    <AuthFrame signup>
      <AuthForm
        signup
        initialInvite={typeof invite === "string" ? invite.slice(0, 128) : ""}
      />
    </AuthFrame>
  );
}
