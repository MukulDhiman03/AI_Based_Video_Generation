import type { Metadata } from "next";
import { requireSession } from "@/lib/server/session";
import { getDashboardData } from "@/lib/server/dashboard";
import { Dashboard } from "@/components/dashboard/dashboard";
import "./dashboard.css";

export const metadata: Metadata = { title: "Overview" };

export default async function HomePage() {
  const { user } = await requireSession();
  const data = await getDashboardData(user.id);
  return (
    <Dashboard
      user={{
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
      }}
      data={data}
    />
  );
}
