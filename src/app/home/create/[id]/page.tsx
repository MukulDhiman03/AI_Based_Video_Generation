import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Dashboard } from "@/components/dashboard/dashboard";
import { ContentComposer } from "@/components/dashboard/content-composer";
import { requireSession } from "@/lib/server/session";
import { getDashboardData } from "@/lib/server/dashboard";
import { contentItemDTO } from "@/lib/server/content-creation";
import { IdeaError } from "@/lib/server/idea-http";
import "../create.css";
export const metadata: Metadata = { title: "Content draft" };
export default async function ContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requireSession();
  const { id } = await params;
  let item;
  try {
    item = await contentItemDTO(user.id, id);
  } catch (error) {
    if (error instanceof IdeaError && error.status === 404) notFound();
    throw error;
  }
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
      <ContentComposer key={id} userId={user.id} initialItem={item} />
    </Dashboard>
  );
}
