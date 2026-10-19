import { requireSession } from "@/lib/server/session";
import "./dashboard.css";

// Resolve authentication before the page's loading boundary can stream.
// The page and API also validate sessions independently.
export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return children;
}
