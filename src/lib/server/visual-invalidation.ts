import "server-only";
import type { ObjectId } from "mongodb";
import { getDatabase } from "./mongodb";
export async function cancelStaleVisualJobs(
  userId: string,
  contentItemId: ObjectId,
  revision: number,
  planRequestId: string | null,
) {
  await (
    await getDatabase()
  )
    .collection("generation_jobs")
    .updateMany(
      {
        kind: "visuals",
        userId,
        contentItemId,
        status: { $in: ["queued", "running"] },
        $or: [
          { "snapshot.revision": { $ne: revision } },
          { "snapshot.planRequestId": { $ne: planRequestId } },
        ],
      },
      {
        $set: {
          status: "cancelled",
          error: "The saved plan changed.",
          lease: null,
          leaseUntil: null,
          updatedAt: new Date(),
        },
      },
    );
}
