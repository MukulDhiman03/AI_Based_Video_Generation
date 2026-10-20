// Local aliases must keep the configured protocol and port. Production domains
// trust only the explicitly configured origin; no request-host inference.
export function appOrigins(baseURL: string): string[] {
  const configured = new URL(baseURL);
  const origins = [configured.origin];
  if (["localhost", "127.0.0.1"].includes(configured.hostname)) {
    const alias = new URL(configured.origin);
    alias.hostname =
      configured.hostname === "localhost" ? "127.0.0.1" : "localhost";
    origins.push(alias.origin);
  }
  return origins;
}
export function isAppOrigin(origin: string | null, baseURL: string): boolean {
  return origin !== null && appOrigins(baseURL).includes(origin);
}
