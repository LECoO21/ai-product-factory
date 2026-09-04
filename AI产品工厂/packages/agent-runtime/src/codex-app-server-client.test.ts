import { describe, expect, it } from "vitest";
import {
  CodexAppServerClient,
  type CodexTransport,
  type CodexTransportHandlers
} from "./codex-app-server-client";

class FakeTransport implements CodexTransport {
  handlers: CodexTransportHandlers | null = null;
  sent: Array<Record<string, unknown>> = [];

  constructor(private readonly respond: (message: Record<string, unknown>, transport: FakeTransport) => void) {}

  async start(handlers: CodexTransportHandlers) {
    this.handlers = handlers;
  }

  async send(value: unknown) {
    const message = value as Record<string, unknown>;
    this.sent.push(message);
    this.respond(message, this);
  }

  emit(message: unknown) {
    this.handlers?.onMessage(message);
  }

  async close() {}
}

const initializedTransport = (extra: (message: Record<string, unknown>, transport: FakeTransport) => void) =>
  new FakeTransport((message, transport) => {
    if (message.method === "initialize") {
      transport.emit({ id: message.id, result: { userAgent: "codex-test" } });
      return;
    }
    extra(message, transport);
  });

describe("CodexAppServerClient", () => {
  it("initializes once before routing account requests", async () => {
    const transport = initializedTransport((message, current) => {
      if (message.method === "account/read") {
        current.emit({
          id: message.id,
          result: {
            account: { type: "chatgpt", email: null, planType: "plus" },
            requiresOpenaiAuth: true
          }
        });
      }
    });
    const client = new CodexAppServerClient({ transportFactory: () => transport });

    const account = await client.request<{ account: { type: string } }>("account/read", {
      refreshToken: false
    });

    expect(account.account.type).toBe("chatgpt");
    expect(transport.sent.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "account/read"
    ]);
  });

  it("routes App Server initiated dynamic tool requests back to the same request id", async () => {
    const transport = initializedTransport(() => undefined);
    const client = new CodexAppServerClient({ transportFactory: () => transport });
    await client.start();
    client.onServerRequest(async (request) => request.method === "item/tool/call"
      ? { handled: true, result: { contentItems: [], success: true } }
      : { handled: false });

    transport.emit({ id: "tool-1", method: "item/tool/call", params: { tool: "workspace_read" } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.sent).toContainEqual({
      id: "tool-1",
      result: { contentItems: [], success: true }
    });
  });

  it("rejects outstanding requests when the transport exits", async () => {
    const transport = initializedTransport(() => undefined);
    const client = new CodexAppServerClient({ transportFactory: () => transport, requestTimeoutMs: 10_000 });
    await client.start();
    const pending = client.request("account/read", { refreshToken: false });
    transport.handlers?.onClose(new Error("process exited"));

    await expect(pending).rejects.toThrow("process exited");
  });

  it("accepts null as an explicit successful RPC result", async () => {
    const transport = initializedTransport((message, current) => {
      if (message.method === "account/read") {
        current.emit({ id: message.id, result: null });
      }
    });
    const client = new CodexAppServerClient({ transportFactory: () => transport });

    await expect(client.request("account/read", { refreshToken: false })).resolves.toBeNull();
  });

  it("preserves a valid numeric RPC error", async () => {
    const transport = initializedTransport((message, current) => {
      if (message.method === "account/read") {
        current.emit({
          id: message.id,
          error: { code: -32001, message: "upstream failed", data: { retryable: true } }
        });
      }
    });
    const client = new CodexAppServerClient({ transportFactory: () => transport });

    await expect(client.request("account/read", { refreshToken: false })).rejects.toMatchObject({
      name: "CodexRpcError",
      code: -32001,
      message: "upstream failed",
      data: { retryable: true }
    });
  });

  it.each([
    ["missing result and error", {}],
    [
      "containing both result and error",
      { result: null, error: { code: -32000, message: "ambiguous" } }
    ],
    ["using a non-object error", { error: "failed" }],
    ["missing an error code", { error: { message: "failed" } }],
    ["using a non-integer error code", { error: { code: "-32000", message: "failed" } }],
    ["missing an error message", { error: { code: -32000 } }],
    ["using a non-string error message", { error: { code: -32000, message: 500 } }]
  ])("rejects a malformed RPC response %s", async (_label, response) => {
    const transport = initializedTransport((message, current) => {
      if (message.method === "account/read") {
        current.emit({ id: message.id, ...response });
      }
    });
    const client = new CodexAppServerClient({ transportFactory: () => transport });

    await expect(client.request("account/read", { refreshToken: false })).rejects.toMatchObject({
      name: "CodexRpcError",
      code: "CODEX_PROTOCOL_ERROR"
    });
  });
});
