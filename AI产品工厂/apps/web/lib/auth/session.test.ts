import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isCodexAccountAuthenticated,
  isFactoryAuthBypassed
} from "./session";

describe("Codex account authentication", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("opens the personal workspace without authentication by default", () => {
    vi.stubEnv("FACTORY_AUTH_REQUIRED", "");
    vi.stubEnv("FACTORY_AUTH_BYPASS", "");
    expect(isFactoryAuthBypassed()).toBe(true);
  });

  it("restores authentication only with an explicit opt-in", () => {
    vi.stubEnv("FACTORY_AUTH_REQUIRED", "true");
    vi.stubEnv("FACTORY_AUTH_BYPASS", "");
    expect(isFactoryAuthBypassed()).toBe(false);
    vi.stubEnv("FACTORY_AUTH_REQUIRED", "1");
    expect(isFactoryAuthBypassed()).toBe(true);
  });

  it("lets the new requirement switch override the retired bypass setting", () => {
    vi.stubEnv("FACTORY_AUTH_REQUIRED", "true");
    vi.stubEnv("FACTORY_AUTH_BYPASS", "true");
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
