import { MongoClient } from "mongodb";
import { getMongoConfig } from "../src/lib/server/database-config.mjs";
import { applicationCollections } from "./database-schema.mjs";

let client;
try {
  const { uri, databaseName } = getMongoConfig();
  client = new MongoClient(uri, {
    appName: "VidSutra-database-setup",
    serverSelectionTimeoutMS: 15_000,
    maxPoolSize: 2,
  });
  await client.connect();
  const db = client.db(databaseName);
  await db.command({ ping: 1 });

  // Inspect only our target namespace. Never adopt a populated, unmarked
  // database, drop collections, or change another application's records.
  const existing = await db.listCollections({}, { nameOnly: true }).toArray();
  const metadata = db.collection("_app_metadata");
  if (existing.length > 0) {
    const owner = await metadata.findOne({ _id: "vidsutra-ai" });
    if (owner?.application !== "vidsutra-ai") {
      throw new Error(
        "Target database already exists without VidSutra ownership; no changes made.",
      );
    }
  } else {
    await db.createCollection("_app_metadata");
    await metadata.insertOne({
      _id: "vidsutra-ai",
      application: "vidsutra-ai",
      schemaVersion: 1,
      createdAt: new Date(),
    });
  }

  const names = new Set(existing.map(({ name }) => name));
  for (const collection of applicationCollections) {
    if (!names.has(collection.name)) await db.createCollection(collection.name);
    await db.collection(collection.name).createIndexes(collection.indexes);
  }

  const verifiedAt = new Date();
  await metadata.updateOne(
    { _id: "vidsutra-ai" },
    { $set: { lastVerifiedAt: verifiedAt } },
  );
  const verified = await metadata.findOne({ _id: "vidsutra-ai" });
  if (verified?.lastVerifiedAt?.getTime() !== verifiedAt.getTime()) {
    throw new Error("Database verification failed.");
  }
  for (const collection of applicationCollections) {
    const indexes = await db
      .collection(collection.name)
      .listIndexes()
      .toArray();
    if (
      !collection.indexes.every(({ name }) =>
        indexes.some((index) => index.name === name),
      )
    ) {
      throw new Error("Database index verification failed.");
    }
  }

  const indexCount = applicationCollections.reduce(
    (count, collection) => count + collection.indexes.length,
    0,
  );
  console.log(
    `Verified ${databaseName}: ping, write/read, ${applicationCollections.length + 1} collections, and ${indexCount} application indexes.`,
  );
  console.log("All operations were confined to the VidSutra database.");
} catch (error) {
  // Driver messages can contain connection details; print only safe diagnostics.
  if (error?.name?.startsWith("Mongo") || error?.syscall) {
    console.error(
      `MongoDB setup failed (${error.name}, code ${error.code ?? "unavailable"}).`,
    );
    console.error(
      "Check credentials, Atlas Network Access, DNS, and database-user permissions.",
    );
  } else {
    console.error(
      error instanceof Error ? error.message : "Database setup failed.",
    );
  }
  process.exitCode = 1;
} finally {
  await client?.close();
}
