import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isCodexAccountAuthenticated,
  isFactoryAuthBypassed
} from "./session";

describe("Codex account authentication", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires authentication by default", () => {
    vi.stubEnv("FACTORY_AUTH_BYPASS", "");
    expect(isFactoryAuthBypassed()).toBe(false);
  });

  it("allows only the explicit test bypass value", () => {
    vi.stubEnv("FACTORY_AUTH_BYPASS", "true");
    expect(isFactoryAuthBypassed()).toBe(true);
    vi.stubEnv("FACTORY_AUTH_BYPASS", "1");
    expect(isFactoryAuthBypassed()).toBe(false);
  });

  it("accepts an authenticated ChatGPT account", () => {
    expect(isCodexAccountAuthenticated({
      authenticated: true,
      accountType: "chatgpt",
      capturedAt: "2026-09-02T08:00:00.000Z"
    }, Date.parse("2026-09-02T08:00:30.000Z"))).toBe(true);
  });

  it("rejects missing, logged-out, non-ChatGPT, and stale account states", () => {
    expect(isCodexAccountAuthenticated(null)).toBe(false);
    expect(isCodexAccountAuthenticated({
      authenticated: false,
      accountType: null,
      capturedAt: "2026-09-02T08:00:00.000Z"
    })).toBe(false);
    expect(isCodexAccountAuthenticated({
      authenticated: true,
      accountType: "apiKey",
      capturedAt: "2026-09-02T08:00:00.000Z"
    })).toBe(false);
    expect(isCodexAccountAuthenticated({
      authenticated: true,
      accountType: "chatgpt",
      capturedAt: "2026-09-02T08:00:00.000Z"
    }, Date.parse("2026-09-02T08:01:00.000Z"))).toBe(false);
    expect(isCodexAccountAuthenticated({
      authenticated: true,
      accountType: "chatgpt",
      capturedAt: "invalid"
    })).toBe(false);
  });
});
