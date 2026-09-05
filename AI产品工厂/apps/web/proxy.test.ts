import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

describe("API mutation protection without login", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("rejects cross-site %s before routing", async (method) => {
    vi.stubEnv("FACTORY_AUTH_REQUIRED", "false");
    const response = await proxy(new NextRequest("http://localhost:3000/api/projects", {
      method, headers: { host: "localhost:3000", origin: "https://evil.example", "content-type": "text/plain" }
    }));
    expect(response.status).toBe(403);
  });

  it("accepts a same-origin POST and read-only health check", async () => {
    vi.stubEnv("FACTORY_AUTH_REQUIRED", "false");
    expect((await proxy(new NextRequest("http://localhost:3000/api/projects", {
      method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }
    }))).status).toBe(200);
    expect((await proxy(new NextRequest("http://localhost:3000/api/health"))).status).toBe(200);
  });
});
