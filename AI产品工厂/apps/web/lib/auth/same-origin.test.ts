import { describe, expect, it } from "vitest";
import { isSameOriginAccountMutation } from "./same-origin";

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
