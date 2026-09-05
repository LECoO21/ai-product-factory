const normalizedHost = (protocol: string, host: string) => {
  if (!host || /[\s/,\\@?#]/.test(host)) return null;
  try {
    return new URL(`${protocol}//${host}`).host;
  } catch {
    return null;
  }
};

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Require an exact browser Origin/Host match. Next may canonicalize the
 * internal URL to localhost; only loopback aliases on the same port qualify.
 * Forwarded headers are never trusted implicitly. */
export const isSameOriginMutation = (request: Request) => {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || origin === "null" || !host) return false;

  try {
    const requestUrl = new URL(request.url);
    const requestHost = normalizedHost(requestUrl.protocol, host);
    if (!requestHost) return false;
    const incoming = new URL(`${requestUrl.protocol}//${requestHost}`);
    const originUrl = new URL(origin);
    if (origin !== originUrl.origin || originUrl.host !== requestHost) return false;
    const configured = process.env.FACTORY_WEB_ORIGIN?.trim();
    if (configured && originUrl.origin === new URL(configured).origin) return true;
    const internalMatches = incoming.host === requestUrl.host || (
      loopback.has(incoming.hostname) && loopback.has(requestUrl.hostname) &&
      incoming.port === requestUrl.port
    );
    return internalMatches && originUrl.protocol === requestUrl.protocol;
  } catch {
    return false;
  }
};

export const isSameOriginAccountMutation = isSameOriginMutation;
