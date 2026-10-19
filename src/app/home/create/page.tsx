import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/dashboard";
import { ContentComposer } from "@/components/dashboard/content-composer";
import { requireSession } from "@/lib/server/session";
import { getDashboardData } from "@/lib/server/dashboard";
import "./create.css";
export const metadata: Metadata = { title: "Create content" };
export default async function CreatePage() {
  const { user } = await requireSession();
  return (
    <Dashboard
      user={{
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
      }}
      data={await getDashboardData(user.id)}
      activePage="create"
    >
      <ContentComposer userId={user.id} initialItem={null} />
    </Dashboard>
  );
}
