export type CodexAccountSnapshot = {
  authenticated: boolean;
  accountType: string | null;
  capturedAt: string | null;
};

export const CODEX_ACCOUNT_SNAPSHOT_MAX_AGE_MS = 45_000;

/** Test-only escape hatch. Normal development and production require Codex login. */
export const isFactoryAuthBypassed = () =>
  process.env.FACTORY_AUTH_BYPASS?.trim() === "true";

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
