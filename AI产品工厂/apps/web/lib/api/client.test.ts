import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { requestJson } from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("requestJson", () => {
  it("returns data only after runtime validation", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ project: { id: "project-1" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      })
    );

    const result = await requestJson("/api/projects", {
      schema: z.object({ project: z.object({ id: z.string() }) })
    });

    expect(result.project.id).toBe("project-1");
  });

  it("normalizes both legacy string errors and structured errors", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "产品不存在" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "run_not_active",
              message: "当前运行已经停止",
              retryable: false,
              requestId: "request-1"
            }
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        )
      );

    await expect(requestJson("/legacy", { schema: z.object({}) })).rejects.toMatchObject({
      code: "HTTP_404",
      userMessage: "产品不存在",
      retryable: false
    });
    await expect(requestJson("/structured", { schema: z.object({}) })).rejects.toMatchObject({
      code: "run_not_active",
      userMessage: "当前运行已经停止",
      retryable: false,
      requestId: "request-1"
    });
  });

  it("turns invalid success payloads into a safe contract error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ project: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(
      requestJson("/api/projects", {
        schema: z.object({ project: z.object({ id: z.string() }) })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: "INVALID_RESPONSE",
        userMessage: "服务返回了无法识别的数据，请刷新后重试。",
        retryable: true
      })
    );
  });
});
