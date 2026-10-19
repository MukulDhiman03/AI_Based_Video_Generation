// Shared by the server connection and database setup command.
export const DATABASE_NAME = 'vidsutra_ai';

export function getMongoConfig(env = process.env) {
  if (!env.MONGODB_URI || env.MONGODB_DB !== DATABASE_NAME) {
    throw new Error('Configure MONGODB_URI and MONGODB_DB=vidsutra_ai.');
  }

  let parsed;
  try {
    parsed = new URL(env.MONGODB_URI);
  } catch {
    throw new Error('MONGODB_URI is not a valid connection string.');
  }

  if (
    !['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) ||
    parsed.pathname !== `/${DATABASE_NAME}`
  ) {
    throw new Error('The MongoDB connection must explicitly target vidsutra_ai.');
  }

  return { uri: env.MONGODB_URI, databaseName: DATABASE_NAME };
}
