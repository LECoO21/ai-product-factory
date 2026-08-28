import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "factory_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

type SessionPayload = {
  version: 1;
  subject: "owner";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

export const isFactoryAuthenticationRequired = () =>
  process.env.FACTORY_AUTH_REQUIRED?.trim() === "true" || process.env.ENV?.trim() === "prod";

const getAuthSecret = () => {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET 必须至少包含 32 个字符");
  }
  return secret;
};

const sign = (payload: string) =>
  createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyInviteCode = (candidate: string) => {
  const codes = (process.env.INVITE_CODES ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  if (codes.length === 0) throw new Error("INVITE_CODES 尚未配置");
  const candidateDigest = createHmac("sha256", getAuthSecret()).update(candidate).digest("hex");
  return codes.some((code) => {
    const configuredDigest = createHmac("sha256", getAuthSecret()).update(code).digest("hex");
    return safeEqual(candidateDigest, configuredDigest);
  });
};

export const createSessionToken = (now = Date.now()) => {
  const issuedAt = Math.floor(now / 1000);
  const payload: SessionPayload = {
    version: 1,
    subject: "owner",
    issuedAt,
    expiresAt: issuedAt + SESSION_TTL_SECONDS,
    nonce: randomUUID()
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
};

export const verifySessionToken = (token: string | undefined, now = Date.now()) => {
  if (!token) return null;
  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra || !safeEqual(sign(payloadPart), signaturePart)) return null;
  try {
    const payload = JSON.parse(decode(payloadPart)) as Partial<SessionPayload>;
    const current = Math.floor(now / 1000);
    if (
      payload.version !== 1 ||
      payload.subject !== "owner" ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      typeof payload.nonce !== "string" ||
      payload.issuedAt > current + 60 ||
      payload.expiresAt <= current
    ) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
};

export const sessionCookieOptions = () => {
  const secureOverride = process.env.FACTORY_COOKIE_SECURE?.trim();
  const secure =
    process.env.ENV?.trim() === "prod" ||
    (secureOverride === "true"
      ? true
      : secureOverride === "false"
        ? false
        : process.env.NODE_ENV === "production");
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  };
};
