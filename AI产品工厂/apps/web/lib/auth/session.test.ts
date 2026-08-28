import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionToken,
  sessionCookieOptions,
  verifyInviteCode,
  verifySessionToken
} from "./session";

const originalSecret = process.env.AUTH_SECRET;
const originalCodes = process.env.INVITE_CODES;
const originalCookieSecure = process.env.FACTORY_COOKIE_SECURE;
const originalEnv = process.env.ENV;

describe("factory session", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
    process.env.INVITE_CODES = "owner-code";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalSecret;
    if (originalCodes === undefined) delete process.env.INVITE_CODES;
    else process.env.INVITE_CODES = originalCodes;
    if (originalCookieSecure === undefined) delete process.env.FACTORY_COOKIE_SECURE;
    else process.env.FACTORY_COOKIE_SECURE = originalCookieSecure;
    if (originalEnv === undefined) delete process.env.ENV;
    else process.env.ENV = originalEnv;
    vi.unstubAllEnvs();
  });

  it("accepts only a configured invite code", () => {
    expect(verifyInviteCode("owner-code")).toBe(true);
    expect(verifyInviteCode("wrong-code")).toBe(false);
  });

  it("accepts a signed session before expiry", () => {
    const now = Date.UTC(2026, 7, 27, 8);
    expect(verifySessionToken(createSessionToken(now), now)?.subject).toBe("owner");
  });

  it("rejects tampered and expired sessions", () => {
    const now = Date.UTC(2026, 7, 27, 8);
    const token = createSessionToken(now);
    expect(verifySessionToken(`${token}changed`, now)).toBeNull();
    expect(verifySessionToken(token, now + 9 * 60 * 60 * 1000)).toBeNull();
  });

  it("allows an explicit insecure cookie only for local HTTP acceptance", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ENV;
    process.env.FACTORY_COOKIE_SECURE = "false";
    expect(sessionCookieOptions().secure).toBe(false);
  });

  it("always keeps cookies secure in the production deployment environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ENV = "prod";
    process.env.FACTORY_COOKIE_SECURE = "false";
    expect(sessionCookieOptions().secure).toBe(true);
  });

  it("does not treat an empty local override as permission to weaken cookies", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ENV;
    process.env.FACTORY_COOKIE_SECURE = "";
    expect(sessionCookieOptions().secure).toBe(true);
  });
});
