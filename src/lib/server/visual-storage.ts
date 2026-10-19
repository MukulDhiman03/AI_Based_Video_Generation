import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { IdeaError } from "./errors";

export type VisualStorageRef = { backend: "r2"; key: string; bucket: string };
export type VisualObjectStore = {
  write(
    bytes: Buffer,
    owner: { userId: string; assetId: string },
  ): Promise<VisualStorageRef>;
  read(ref: VisualStorageRef): Promise<Buffer>;
  remove(ref: VisualStorageRef): Promise<void>;
};

// Server-only dependency injection lets tests exercise the SDK without network calls.
export function createR2ObjectStore(
  client: S3Client,
  bucket: string,
): VisualObjectStore {
  return {
    async write(bytes, owner) {
      const key = `visuals/${owner.userId}/${owner.assetId}.png`;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: "image/png",
          CacheControl: "private, no-store",
        }),
      );
      return { backend: "r2", key, bucket };
    },
    async read(ref) {
      const object = await client.send(
        new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
      );
      if (!object.Body) throw new Error("Missing stored image");
      return Buffer.from(await object.Body.transformToByteArray());
    },
    async remove(ref) {
      await client.send(
        new DeleteObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
      );
    },
  };
}
function r2(): VisualObjectStore {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (
    process.env.VISUAL_STORAGE !== "r2" ||
    !accountId ||
    !/^[a-f\d]{32}$/i.test(accountId) ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY ||
    !process.env.R2_BUCKET_NAME
  )
    throw new IdeaError("Private R2 storage is not configured.", 503);
  return createR2ObjectStore(
    new S3Client({
      maxAttempts: 1,
      region: "auto",
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      requestHandler: { requestTimeout: 20_000, connectionTimeout: 5_000 },
    }),
    process.env.R2_BUCKET_NAME,
  );
}
export const writeVisualObject: VisualObjectStore["write"] = (bytes, owner) =>
  r2().write(bytes, owner);
export const readVisualObject: VisualObjectStore["read"] = (ref) =>
  r2().read(ref);
export const deleteVisualObject: VisualObjectStore["remove"] = (ref) =>
  r2().remove(ref);
