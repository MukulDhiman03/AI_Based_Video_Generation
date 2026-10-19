export type DashboardContent = {
  id: string;
  title: string;
  format: "reel" | "image";
  language: "English" | "Hindi";
  status: "draft" | "queued" | "processing" | "completed" | "failed";
  updatedAt: string | null;
  editable?: boolean;
};

export type DashboardData = {
  recentContent: DashboardContent[];
  featured: DashboardContent | null;
  totalContent: number;
  activeJob: {
    id: string;
    title: string;
    status: string;
    stage: string | null;
  } | null;
  upcoming: {
    id: string;
    title: string;
    scheduledFor: string | null;
    status: string;
  }[];
  connection: {
    status: "connected" | "expired" | "disconnected";
    username: string | null;
  };
  allowance: { limit: number; used: number; resetsAt: string | null } | null;
};
