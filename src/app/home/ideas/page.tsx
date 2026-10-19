import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/dashboard";
import { IdeaStudio } from "@/components/dashboard/idea-studio";
import { requireSession } from "@/lib/server/session";
import { getDashboardData } from "@/lib/server/dashboard";
import { getIdeaDraft, getIdeaRequest } from "@/lib/server/ideas";
import "./ideas.css";

export const metadata: Metadata = { title: "Explore ideas" };
export default async function IdeasPage() {
  const { user } = await requireSession();
  const [data, draft, request] = await Promise.all([
    getDashboardData(user.id),
    getIdeaDraft(user.id),
    getIdeaRequest(user.id),
  ]);
  return (
    <Dashboard
      user={{
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
      }}
      data={data}
    >
      <IdeaStudio
        userId={user.id}
        initialDraft={draft}
        initialRequest={request}
      />
    </Dashboard>
  );
}
