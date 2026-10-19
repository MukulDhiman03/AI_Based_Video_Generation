import "server-only";
import { MongoClient } from "mongodb";
import { getMongoConfig } from "./database-config.mjs";

const connection = globalThis as typeof globalThis & {
  vidsutraMongoConnection?: Promise<MongoClient>;
};

// Reuse the pool across requests and development hot reloads.
export async function getMongoClient() {
  const { uri } = getMongoConfig();

  if (!connection.vidsutraMongoConnection) {
    const client = new MongoClient(uri, {
      appName: "VidSutra",
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 15_000,
      timeoutMS: 30_000,
    });
    connection.vidsutraMongoConnection = client.connect().catch(async () => {
      connection.vidsutraMongoConnection = undefined;
      await client.close().catch(() => undefined);
      // Do not propagate driver errors containing connection details to callers.
      throw new Error("VidSutra database connection failed.");
    });
  }

  return connection.vidsutraMongoConnection;
}

export async function getDatabase() {
  const { databaseName } = getMongoConfig();
  return (await getMongoClient()).db(databaseName);
}
