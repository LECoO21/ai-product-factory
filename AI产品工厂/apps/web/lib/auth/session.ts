export type CodexAccountSnapshot = {
  authenticated: boolean;
  accountType: string | null;
  capturedAt: string | null;
};

export const CODEX_ACCOUNT_SNAPSHOT_MAX_AGE_MS = 45_000;

/**
 * The current personal workspace has no Web login gate. Set
 * FACTORY_AUTH_REQUIRED=true when the login flow needs to be restored.
 * This positive switch intentionally takes precedence over the retired
 * FACTORY_AUTH_BYPASS setting that may remain in older local environments.
 */
export const isFactoryAuthBypassed = () =>
  process.env.FACTORY_AUTH_REQUIRED?.trim() !== "true";

export const isCodexAccountAuthenticated = (
  snapshot: CodexAccountSnapshot | null | undefined,
  now = Date.now(),
  maxAgeMs = CODEX_ACCOUNT_SNAPSHOT_MAX_AGE_MS
) => {
  if (snapshot?.authenticated !== true || snapshot.accountType !== "chatgpt") return false;
  if (!snapshot.capturedAt || maxAgeMs <= 0) return false;
  const capturedAt = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(capturedAt)) return false;
  const age = now - capturedAt;
  return age >= -5_000 && age <= maxAgeMs;
};
