const normalizedHost = (protocol: string, host: string) => {
  if (!host || /[\s/,\\]/.test(host)) return null;
  try {
    return new URL(`${protocol}//${host}`).host;
  } catch {
    return null;
  }
};

/**
 * Protects local Codex account mutations from cross-site form submissions.
 * Browsers attach Origin to these POST requests; callers without one are
 * rejected because the affected account belongs to the whole Codex process.
 */
export const isSameOriginAccountMutation = (request: Request) => {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || origin === "null" || !host) return false;

  try {
    const requestUrl = new URL(request.url);
    const requestHost = normalizedHost(requestUrl.protocol, host);
    if (!requestHost || requestHost !== requestUrl.host) return false;
    return new URL(origin).origin === `${requestUrl.protocol}//${requestHost}`;
  } catch {
    return false;
  }
};
