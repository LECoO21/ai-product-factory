import { z } from "zod";
import { AppError, requestJson } from "@/lib/api/client";

export const codexAccountSchema = z.object({
  authenticated: z.boolean(),
  accountType: z.literal("chatgpt").nullable(),
  emailHint: z.string().nullable(),
  planType: z.string().nullable(),
  requiresOpenaiAuth: z.boolean(),
  capturedAt: z.string().nullable(),
  updatedAt: z.string().nullable()
});

export const runtimeCommandSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "account.login.start",
    "account.login.cancel",
    "account.logout",
    "account.refresh"
  ]),
  status: z.enum(["pending", "running", "completed", "failed"]),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable()
});

export const chatGptLoginResultSchema = z.object({
  loginId: z.string().min(1),
  authUrl: z.string().url()
});

export type CodexAccount = z.infer<typeof codexAccountSchema>;
export type RuntimeCommand = z.infer<typeof runtimeCommandSchema>;

const commandResponseSchema = z.object({ command: runtimeCommandSchema });
const optionalSignal = (signal?: AbortSignal) => signal ? { signal } : {};

export const getAccount = (signal?: AbortSignal) =>
  requestJson("/api/auth/account", {
    method: "GET",
    cache: "no-store",
    ...optionalSignal(signal),
    schema: codexAccountSchema
  });

export const startLogin = (signal?: AbortSignal) =>
  requestJson("/api/auth/login", {
    method: "POST",
    ...optionalSignal(signal),
    schema: commandResponseSchema
  }).then(({ command }) => command);

export const getRuntimeCommand = (id: string, signal?: AbortSignal) =>
  requestJson(`/api/auth/commands/${encodeURIComponent(id)}`, {
    method: "GET",
    cache: "no-store",
    ...optionalSignal(signal),
    schema: commandResponseSchema
  }).then(({ command }) => command);

export const cancelLogin = (loginId: string, signal?: AbortSignal) =>
  requestJson("/api/auth/login/cancel", {
    method: "POST",
    body: JSON.stringify({ loginId }),
    ...optionalSignal(signal),
    schema: commandResponseSchema
  }).then(({ command }) => command);

export const logout = (signal?: AbortSignal) =>
  requestJson("/api/auth/logout", {
    method: "POST",
    ...optionalSignal(signal),
    schema: commandResponseSchema
  }).then(({ command }) => command);

const wait = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const aborted = () => {
      window.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("操作已取消", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", aborted, { once: true });
  });

export async function waitForRuntimeCommand(
  initial: RuntimeCommand,
  options: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number } = {}
) {
  const { signal, timeoutMs = 45_000, pollMs = 700 } = options;
  const deadline = Date.now() + timeoutMs;
  let command = initial;

  while (command.status === "pending" || command.status === "running") {
    if (Date.now() >= deadline) {
      throw new AppError(
        "CODEX_COMMAND_TIMEOUT",
        "Codex 服务暂时没有响应，请确认运行服务已启动后重试。",
        true
      );
    }
    command = await getRuntimeCommand(command.id, signal);
    if (command.status === "pending" || command.status === "running") {
      await wait(pollMs, signal);
    }
  }

  if (command.status === "failed") {
    throw new AppError(
      "CODEX_COMMAND_FAILED",
      command.error || "Codex 操作失败，请重试。",
      true
    );
  }
  return command;
}
