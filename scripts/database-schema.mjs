// Initial namespaces and lookup indexes. Domain validation belongs to the
// corresponding services as they are implemented; this is not an auth schema.
export const applicationCollections = [
  {
    name: "idea_requests",
    indexes: [{ key: { userId: 1, createdAt: -1 }, name: "owner_created" }],
  },
  {
    name: "idea_drafts",
    indexes: [{ key: { userId: 1 }, name: "owner_unique", unique: true }],
  },
  {
    name: "content_items",
    indexes: [
      { key: { userId: 1, createdAt: -1 }, name: "owner_created" },
      {
        key: { userId: 1, creationId: 1 },
        name: "owner_creation_unique",
        unique: true,
        partialFilterExpression: { creationId: { $type: "string" } },
      },
    ],
  },
  {
    name: "content_versions",
    indexes: [
      {
        key: { contentItemId: 1, version: 1 },
        name: "content_version",
        unique: true,
      },
    ],
  },
  {
    name: "generation_jobs",
    indexes: [
      { key: { userId: 1, createdAt: -1 }, name: "owner_created" },
      { key: { status: 1, createdAt: 1 }, name: "status_created" },
      {
        key: { kind: 1, queue: 1, status: 1, updatedAt: 1 },
        name: "visual_queue",
      },
    ],
  },
  {
    name: "media_assets",
    indexes: [
      { key: { contentVersionId: 1 }, name: "content_version" },
      { key: { userId: 1, jobId: 1 }, name: "owner_visual_job" },
    ],
  },
  {
    name: "social_accounts",
    indexes: [{ key: { userId: 1, provider: 1 }, name: "owner_provider" }],
  },
  {
    name: "publications",
    indexes: [
      { key: { userId: 1, scheduledFor: 1 }, name: "owner_schedule" },
      { key: { status: 1, scheduledFor: 1 }, name: "status_schedule" },
    ],
  },
  {
    name: "beta_invitations",
    indexes: [
      { key: { email: 1, status: 1 }, name: "email_status" },
      {
        key: { tokenHash: 1 },
        name: "token_hash",
        unique: true,
        partialFilterExpression: { tokenHash: { $type: "string" } },
      },
    ],
  },
  {
    name: "usage_ledger",
    indexes: [{ key: { userId: 1, createdAt: -1 }, name: "owner_created" }],
  },
  {
    name: "user_feedback",
    indexes: [{ key: { userId: 1, createdAt: -1 }, name: "owner_created" }],
  },
  {
    name: "app_settings",
    indexes: [{ key: { key: 1 }, name: "setting_key", unique: true }],
  },
  {
    name: "user",
    indexes: [{ key: { email: 1 }, name: "email_unique", unique: true }],
  },
  {
    name: "account",
    indexes: [
      {
        key: { providerId: 1, accountId: 1 },
        name: "provider_account_unique",
        unique: true,
      },
      { key: { userId: 1 }, name: "user_id" },
    ],
  },
  {
    name: "session",
    indexes: [
      { key: { token: 1 }, name: "token_unique", unique: true },
      { key: { userId: 1 }, name: "user_id" },
      { key: { expiresAt: 1 }, name: "session_expiry", expireAfterSeconds: 0 },
    ],
  },
  {
    name: "verification",
    indexes: [{ key: { identifier: 1 }, name: "identifier" }],
  },
  {
    name: "rateLimit",
    indexes: [{ key: { key: 1 }, name: "key_unique", unique: true }],
  },
];
