import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

export type CodexRpcId = string | number;

export type CodexNotification = {
  method: string;
  params?: unknown;
};

export type CodexServerRequest = CodexNotification & {
  id: CodexRpcId;
};

type RpcErrorResponse = {
  id: CodexRpcId;
  error: { code: number; message: string; data?: unknown };
};

type RpcResponse =
  | { id: CodexRpcId; result: unknown }
  | RpcErrorResponse;

export type CodexTransportHandlers = {
  onMessage(message: unknown): void;
  onClose(error: Error): void;
};

export interface CodexTransport {
  start(handlers: CodexTransportHandlers): Promise<void>;
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
}

export type CodexTransportFactory = () => CodexTransport;

const processClosedMessage = (code: number | null, signal: NodeJS.Signals | null) =>
  `Codex App Server 已退出（code=${code ?? "null"}, signal=${signal ?? "none"}）`;

export class StdioCodexTransport implements CodexTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: ReadlineInterface | null = null;
  private closing = false;

  constructor(
    private readonly binary = process.env.CODEX_BINARY?.trim() || "codex",
    private readonly args = ["app-server", "--stdio"]
  ) {}

  async start(handlers: CodexTransportHandlers) {
    if (this.child) return;
    const child = spawn(this.binary, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => {
      try {
        handlers.onMessage(JSON.parse(line) as unknown);
      } catch {
        handlers.onClose(new Error("Codex App Server 返回了无效 JSONL"));
        void this.close();
      }
    });
    // stderr may contain upstream diagnostics. Never mirror it because it can include user data.
    child.stderr.resume();
    child.once("exit", (code, signal) => {
      this.child = null;
      this.lines?.close();
      this.lines = null;
      if (!this.closing) handlers.onClose(new Error(processClosedMessage(code, signal)));
    });

    await new Promise<void>((resolve, reject) => {
      const spawned = () => {
        child.off("error", failed);
        child.on("error", (error) => handlers.onClose(error));
        resolve();
      };
      const failed = (error: Error) => {
        child.off("spawn", spawned);
        this.child = null;
        reject(new Error(`无法启动 Codex App Server：${error.message}`));
      };
      child.once("spawn", spawned);
      child.once("error", failed);
    });
  }

  async send(message: unknown) {
    const child = this.child;
    if (!child || child.stdin.destroyed) throw new Error("Codex App Server 未连接");
    const line = `${JSON.stringify(message)}\n`;
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(line, (error) => error ? reject(error) : resolve());
    });
  }

  async close() {
    const child = this.child;
    if (!child) return;
    this.closing = true;
    this.lines?.close();
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(resolve, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.child = null;
    this.lines = null;
  }
}

export class CodexRpcError extends Error {
  constructor(
    message: string,
    readonly code: string | number = "CODEX_RPC_ERROR",
    readonly data?: unknown
  ) {
    super(message);
    this.name = "CodexRpcError";
  }
}

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

export type CodexServerRequestResult =
  | { handled: true; result: unknown }
  | { handled: false };

export type CodexServerRequestHandler = (
  request: CodexServerRequest
) => Promise<CodexServerRequestResult> | CodexServerRequestResult;

export type CodexAppServerClientOptions = {
  transportFactory?: CodexTransportFactory;
  requestTimeoutMs?: number;
  clientVersion?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasOwn = (value: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);

const invalidRpcResponse = (reason: string) =>
  new CodexRpcError(
    `Codex App Server 返回了无效 RPC 响应：${reason}`,
    "CODEX_PROTOCOL_ERROR"
  );

const parseRpcResponse = (
  message: Record<string, unknown>,
  id: CodexRpcId
): RpcResponse => {
  const hasResult = hasOwn(message, "result");
  const hasError = hasOwn(message, "error");
  if (hasResult === hasError) {
    throw invalidRpcResponse(hasResult ? "result 与 error 不能同时存在" : "缺少 result 或 error");
  }
  if (hasResult) return { id, result: message.result };

  const error = message.error;
  if (!isRecord(error)) throw invalidRpcResponse("error 必须是对象");
  if (typeof error.code !== "number" || !Number.isInteger(error.code)) {
    throw invalidRpcResponse("error.code 必须是整数");
  }
  if (typeof error.message !== "string") {
    throw invalidRpcResponse("error.message 必须是字符串");
  }
  return {
    id,
    error: {
      code: error.code,
      message: error.message,
      ...(hasOwn(error, "data") ? { data: error.data } : {})
    }
  };
};

export class CodexAppServerClient {
  private transport: CodexTransport | null = null;
  private startPromise: Promise<void> | null = null;
  private initialized = false;
  private stopped = false;
  private nextId = 1;
  private readonly pending = new Map<CodexRpcId, PendingRequest>();
  private readonly notifications = new Set<(notification: CodexNotification) => void>();
  private readonly serverRequestHandlers = new Set<CodexServerRequestHandler>();
  private readonly connectionClosedListeners = new Set<(error: Error) => void>();
  private readonly transportFactory: CodexTransportFactory;
  private readonly requestTimeoutMs: number;
  private readonly clientVersion: string;

  constructor(options: CodexAppServerClientOptions = {}) {
    this.transportFactory = options.transportFactory ?? (() => new StdioCodexTransport());
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.clientVersion = options.clientVersion ?? "0.1.0";
  }

  isReady() {
    return this.initialized;
  }

  async start() {
    if (this.initialized) return;
    if (this.stopped) throw new Error("Codex App Server 客户端已停止");
    this.startPromise ??= this.startConnection();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startConnection() {
    const transport = this.transportFactory();
    this.transport = transport;
    try {
      await transport.start({
        onMessage: (message) => this.receive(message),
        onClose: (error) => this.connectionClosed(error)
      });
      await this.requestRaw("initialize", {
        clientInfo: {
          name: "naxe_ai_product_factory",
          title: "Naxe AI 产品工厂",
          version: this.clientVersion
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false
        }
      });
      await transport.send({ method: "initialized" });
      this.initialized = true;
    } catch (error) {
      this.initialized = false;
      this.transport = null;
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  private connectionClosed(error: Error) {
    this.initialized = false;
    this.transport = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.connectionClosedListeners) listener(error);
  }

  private receive(message: unknown) {
    if (!isRecord(message)) return;
    const id = message.id;
    const method = message.method;
    if ((typeof id === "string" || typeof id === "number") && typeof method !== "string") {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      let response: RpcResponse;
      try {
        response = parseRpcResponse(message, id);
      } catch (error) {
        pending.reject(error instanceof Error ? error : invalidRpcResponse("未知格式错误"));
        return;
      }
      if ("error" in response) {
        pending.reject(new CodexRpcError(
          response.error.message,
          response.error.code,
          response.error.data
        ));
      } else {
        pending.resolve(response.result);
      }
      return;
    }
    if (typeof method !== "string") return;
    if (typeof id === "string" || typeof id === "number") {
      void this.handleServerRequest({ id, method, params: message.params });
      return;
    }
    const notification = { method, ...(message.params === undefined ? {} : { params: message.params }) };
    for (const listener of this.notifications) listener(notification);
  }

  private async handleServerRequest(request: CodexServerRequest) {
    for (const handler of this.serverRequestHandlers) {
      try {
        const response = await handler(request);
        if (!response.handled) continue;
        await this.transport?.send({ id: request.id, result: response.result });
        return;
      } catch (error) {
        await this.transport?.send({
          id: request.id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : "工具执行失败"
          }
        });
        return;
      }
    }
    await this.transport?.send({
      id: request.id,
      error: { code: -32601, message: `未注册服务端请求处理器：${request.method}` }
    });
  }

  private requestRaw<T>(method: string, params?: unknown, timeoutMs = this.requestTimeoutMs) {
    const transport = this.transport;
    if (!transport) return Promise.reject(new Error("Codex App Server 未连接"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexRpcError(`Codex 请求超时：${method}`, "CODEX_REQUEST_TIMEOUT"));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timeout });
      void transport
        .send({ method, id, ...(params === undefined ? {} : { params }) })
        .catch((error) => {
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          clearTimeout(pending.timeout);
          pending.reject(error instanceof Error ? error : new Error("Codex 请求发送失败"));
        });
    });
  }

  request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.initialized) return this.requestRaw<T>(method, params, timeoutMs);
    return this.start().then(() => this.requestRaw<T>(method, params, timeoutMs));
  }

  notify(method: string, params?: unknown): Promise<void> {
    const send = () => {
      const transport = this.transport;
      if (!transport) return Promise.reject(new Error("Codex App Server 未连接"));
      return transport.send({ method, ...(params === undefined ? {} : { params }) });
    };
    if (this.initialized) return send();
    return this.start().then(send);
  }

  onNotification(listener: (notification: CodexNotification) => void) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onServerRequest(handler: CodexServerRequestHandler) {
    this.serverRequestHandlers.add(handler);
    return () => this.serverRequestHandlers.delete(handler);
  }

  onConnectionClosed(listener: (error: Error) => void) {
    this.connectionClosedListeners.add(listener);
    return () => this.connectionClosedListeners.delete(listener);
  }

  async close() {
    this.stopped = true;
    const transport = this.transport;
    this.connectionClosed(new Error("Codex App Server 客户端已停止"));
    await transport?.close();
  }
}
