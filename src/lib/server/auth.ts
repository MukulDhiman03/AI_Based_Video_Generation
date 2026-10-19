import "server-only";
import { betterAuth } from "better-auth/minimal";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import type { MongoClient } from "mongodb";
import { DATABASE_NAME } from "./database-config.mjs";
import { getMongoClient } from "./mongodb";
import { findInvitation, hashInvitation } from "./invitations";

function createAuth(client: MongoClient) {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || !baseURL) {
    throw new Error("Authentication server configuration is incomplete.");
  }
  const db = client.db(DATABASE_NAME);

  return betterAuth({
    appName: "VidSutra.ai",
    baseURL,
    secret,
    database: mongodbAdapter(db, { client }),
    trustedOrigins: [new URL(baseURL).origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      // Delivery is not configured yet. Never mark these accounts verified.
      requireEmailVerification: false,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path !== "/sign-up/email") return;
        const email = context.body?.email;
        const token = context.headers?.get("x-vidsutra-invite")?.trim() || "";
        if (!token) return;
        if (
          typeof email !== "string" ||
          !(await findInvitation(token, email))
        ) {
          throw new APIError("FORBIDDEN", {
            code: "INVALID_INVITATION",
            message: "Check your invitation code or leave it blank to sign up without one.",
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            if (user.name.trim().length < 2 || user.name.length > 100) {
              throw new APIError("BAD_REQUEST", {
                message: "Use a name between 2 and 100 characters.",
              });
            }
            const token = context?.headers?.get("x-vidsutra-invite")?.trim() || "";
            if (token && !await findInvitation(token, user.email)) {
              throw new APIError("FORBIDDEN", {
                code: "INVALID_INVITATION",
                message:
                  "Check your invitation code or leave it blank to sign up without one.",
              });
            }
            return {
              data: {
                ...user,
                email: user.email.trim().toLowerCase(),
                name: user.name.trim(),
              },
            };
          },
          after: async (user, context) => {
            // Runs after the account transaction commits. Unique user.email
            // prevents the same email-bound invitation creating extra users.
            const token = context?.headers?.get("x-vidsutra-invite")?.trim() || "";
            if (!token) return;
            await db
              .collection("beta_invitations")
              .updateOne(
                {
                  tokenHash: hashInvitation(token),
                  email: user.email,
                  status: "pending",
                },
                {
                  $set: {
                    status: "accepted",
                    acceptedAt: new Date(),
                    userId: user.id,
                  },
                },
              );
          },
        },
      },
    },
  });
}

let authPromise: Promise<ReturnType<typeof createAuth>> | undefined;

export function getAuth() {
  if (!authPromise) {
    authPromise = getMongoClient()
      .then(createAuth)
      .catch(() => {
        authPromise = undefined;
        throw new Error("Authentication service is unavailable.");
      });
  }
  return authPromise;
}
