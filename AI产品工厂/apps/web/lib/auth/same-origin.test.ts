import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOriginAccountMutation } from "./same-origin";

afterEach(() => vi.unstubAllEnvs());

const request = (
  url = "http://localhost:3000/api/auth/logout",
  headers: Record<string, string> = {
    host: "localhost:3000",
    origin: "http://localhost:3000"
  }
) => new Request(url, { method: "POST", headers });

describe("isSameOriginAccountMutation", () => {
  it("accepts an exact same-origin browser request", () => {
    expect(isSameOriginAccountMutation(request())).toBe(true);
  });

  it("accepts a loopback Host canonicalized by Next without treating different origins as equal", () => {
    expect(isSameOriginAccountMutation(request(undefined, {
      host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000"
    }))).toBe(true);
    expect(isSameOriginAccountMutation(request(undefined, {
      host: "127.0.0.1:3000", origin: "http://localhost:3000"
    }))).toBe(false);
  });

  it("does not trust spoofed forwarded headers or an external Host", () => {
    expect(isSameOriginAccountMutation(request(undefined, {
      host: "evil.example", origin: "http://evil.example",
      "x-forwarded-host": "evil.example", "x-forwarded-proto": "http"
    }))).toBe(false);
  });

  it("allows an explicitly configured HTTPS origin behind a reverse proxy only with its matching Host", () => {
    vi.stubEnv("FACTORY_WEB_ORIGIN", "https://prodline.example");
    expect(isSameOriginAccountMutation(request(undefined, {
      host: "prodline.example", origin: "https://prodline.example"
    }))).toBe(true);
    expect(isSameOriginAccountMutation(request(undefined, {
      host: "evil.example", origin: "https://prodline.example"
    }))).toBe(false);
  });

  it("rejects a cross-site request targeting the local server", () => {
    expect(isSameOriginAccountMutation(request(undefined, {
      host: "localhost:3000",
      origin: "https://attacker.example"
    }))).toBe(false);
  });

  it("rejects missing and opaque origins", () => {
    expect(isSameOriginAccountMutation(request(undefined, {
      host: "localhost:3000"
    }))).toBe(false);
    expect(isSameOriginAccountMutation(request(undefined, {
      host: "localhost:3000",
      origin: "null"
    }))).toBe(false);
  });

  it("rejects protocol and Host mismatches", () => {
    expect(isSameOriginAccountMutation(request(undefined, {
      host: "localhost:3000",
      origin: "https://localhost:3000"
    }))).toBe(false);
    expect(isSameOriginAccountMutation(request(undefined, {
      host: "example.test",
      origin: "http://localhost:3000"
    }))).toBe(false);
  });
});
