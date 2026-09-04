import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CodexRpcError } from "@factory/agent-runtime";
import { SqliteCodexRuntimeStore } from "@factory/records";
import {
  markCodexAccountUnavailable,
  processNextCodexAccountCommand,
  processNextCodexThreadCleanup,
  refreshCodexAccountSnapshot,
  shutdownCodexRuntime,
  startCodexAccountHeartbeat,
  refreshCodexRuntimeSnapshots
} from "./codex-control";

const createStore = () => new SqliteCodexRuntimeStore(
  join(mkdtempSync(join(tmpdir(), "factory-worker-codex-")), "factory.sqlite")
);

const fakeAccount = () => ({
  read: vi.fn(async () => ({
    authenticated: true,
    account: { type: "chatgpt" as const, email: "owner@example.com", planType: "plus" },
    requiresOpenaiAuth: true
  })),
  startChatGptLogin: vi.fn(async () => ({
    loginId: "login-1",
    authUrl: "https://auth.openai.com/codex"
  })),
  cancelLogin: vi.fn(async () => undefined),
  logout: vi.fn(async () => undefined),
  listSkills: vi.fn(async () => [{ name: "imagegen", enabled: true }]),
  readProviderCapabilities: vi.fn(async () => ({
    namespaceTools: true,
    imageGeneration: true,
    webSearch: true
  }))
});

describe("Codex worker control", () => {
  it("deletes one queued Codex Thread and then clears its persisted bindings", async () => {
    const store = createStore();
    store.saveThreadBinding("product-1", "thread-1");
    store.saveTurnBinding("run-1", "thread-1", "turn-1");
    store.enqueueProductThreadCleanups("product-1");
    const client = { request: vi.fn(async () => ({})) };

    await expect(processNextCodexThreadCleanup({
      workerId: "worker-1",
      client,
      store
    })).resolves.toBe(true);

    expect(client.request).toHaveBeenCalledWith(
      "thread/delete",
      { threadId: "thread-1" },
      30_000
    );
    expect(store.getThreadBinding("product-1")).toBeNull();
    expect(store.getTurnBinding("run-1")).toBeNull();
    expect(store.claimNextThreadCleanup("worker-2")).toBeNull();
    store.close();
  });

  it("treats an already-missing upstream Thread as a completed cleanup", async () => {
    const store = createStore();
    store.saveThreadBinding("product-1", "thread-missing");
    store.saveTurnBinding("run-1", "thread-missing", "turn-1");
    store.enqueueProductThreadCleanups("product-1");
    const client = {
      request: vi.fn(async () => {
        throw new CodexRpcError("missing", -32000, { code: "THREAD_NOT_FOUND" });
      })
    };

    await expect(processNextCodexThreadCleanup({
      workerId: "worker-1",
      client,
      store
    })).resolves.toBe(true);

    expect(store.getThreadBinding("product-1")).toBeNull();
    expect(store.getTurnBinding("run-1")).toBeNull();
    expect(store.claimNextThreadCleanup("worker-2")).toBeNull();
    store.close();
  });

  it("retains bindings and reschedules cleanup after a transient App Server failure", async () => {
    const store = createStore();
    store.saveThreadBinding("product-1", "thread-retry");
    store.saveTurnBinding("run-1", "thread-retry", "turn-1");
    store.enqueueProductThreadCleanups("product-1");
    const error = new CodexRpcError("service unavailable", "INTERNAL");
    const client = { request: vi.fn(async () => { throw error; }) };
    const onError = vi.fn();

    await expect(processNextCodexThreadCleanup({
      workerId: "worker-1",
      client,
      store,
      retryDelayMs: 0,
      onError
    })).resolves.toBe(true);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread-retry" }), error);
    expect(store.getThreadBinding("product-1")?.threadId).toBe("thread-retry");
    expect(store.getTurnBinding("run-1")?.turnId).toBe("turn-1");
    expect(store.claimNextThreadCleanup("worker-2")).toMatchObject({
      status: "running",
      workerId: "worker-2",
      attempts: 2,
      lastError: "Codex Thread 删除失败（CodexRpcError）"
    });
    store.close();
  });

  it("processes a cleanup again after recovering a crashed worker claim", async () => {
    const store = createStore();
    store.saveThreadBinding("product-1", "thread-recovered");
    store.enqueueProductThreadCleanups("product-1");
    store.claimNextThreadCleanup("worker-crashed");
    store.recoverRunningThreadCleanups();
    const client = { request: vi.fn(async () => ({})) };

    await expect(processNextCodexThreadCleanup({
      workerId: "worker-restarted",
      client,
      store
    })).resolves.toBe(true);

    expect(client.request).toHaveBeenCalledWith(
      "thread/delete",
      { threadId: "thread-recovered" },
      30_000
    );
    expect(store.getThreadBinding("product-1")).toBeNull();
    store.close();
  });

  it("claims a browser-login command and persists only the public login handoff", async () => {
    const store = createStore();
    const account = fakeAccount();
    const command = store.createCommand({ type: "account.login.start", payload: {} });

    await expect(processNextCodexAccountCommand({
      workerId: "worker-1",
      account,
      store,
      cwd: process.cwd()
    })).resolves.toBe(true);

    expect(store.getCommand(command.id)).toMatchObject({
      status: "completed",
      result: {
        loginId: "login-1",
        authUrl: "https://auth.openai.com/codex"
      }
    });
    expect(account.startChatGptLogin).toHaveBeenCalledOnce();
    store.close();
  });

  it("refreshes a masked ChatGPT account and fails closed for missing media tools", async () => {
    const store = createStore();
    const account = fakeAccount();

    const snapshots = await refreshCodexRuntimeSnapshots({
      account,
      store,
      cwd: process.cwd(),
      environment: {}
    });

    expect(snapshots.account).toMatchObject({
      authenticated: true,
      accountType: "chatgpt",
      emailHint: "o***@e***.com",
      planType: "plus"
    });
    expect(snapshots.capabilities.capabilities).toEqual([
      expect.objectContaining({
        kind: "image",
        status: "attemptable",
        source: "codex-app-server:image-generation+codex-skill:imagegen"
      }),
      expect.objectContaining({ kind: "audio", status: "unavailable", source: null }),
      expect.objectContaining({ kind: "model3d", status: "unavailable", source: null })
    ]);
    store.close();
  });

  it("rejects a malformed cancel command without storing an upstream error", async () => {
    const store = createStore();
    const account = fakeAccount();
    const command = store.createCommand({ type: "account.login.cancel", payload: {} });

    await processNextCodexAccountCommand({
      workerId: "worker-1",
      account,
      store,
      cwd: process.cwd()
    });

    expect(store.getCommand(command.id)).toMatchObject({
      status: "failed",
      error: "无法取消 OpenAI 登录，请稍后重试"
    });
    expect(account.cancelLogin).not.toHaveBeenCalled();
    store.close();
  });

  it("keeps the account snapshot fresh without rescanning media capabilities", async () => {
    vi.useFakeTimers();
    const store = createStore();
    const account = fakeAccount();
    try {
      const stopHeartbeat = startCodexAccountHeartbeat(
        () => refreshCodexAccountSnapshot(account, store),
        15_000
      );

      await vi.advanceTimersByTimeAsync(30_000);
      expect(account.read).toHaveBeenCalledTimes(2);
      expect(account.listSkills).not.toHaveBeenCalled();
      expect(account.readProviderCapabilities).not.toHaveBeenCalled();

      stopHeartbeat();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(account.read).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      store.close();
    }
  });

  it("fails the persisted login gate closed when App Server is unavailable", () => {
    const store = createStore();
    store.setAccountSnapshot({
      authenticated: true,
      accountType: "chatgpt",
      email: "owner@example.com",
      planType: "plus",
      requiresOpenaiAuth: true
    });

    expect(markCodexAccountUnavailable(store)).toMatchObject({
      authenticated: false,
      accountType: null,
      emailHint: null,
      planType: null,
      requiresOpenaiAuth: true
    });
    store.close();
  });

  it("interrupts the active production run before closing App Server", async () => {
    let finishRun!: () => void;
    const activeRunFinished = new Promise<void>((resolve) => { finishRun = resolve; });
    const actions: string[] = [];
    const shutdown = shutdownCodexRuntime({
      activeRunId: "run-1",
      activeRunFinished,
      abort: async (runId) => { actions.push(`abort:${runId}`); },
      close: async () => { actions.push("close"); },
      graceMs: 1_000
    });

    await vi.waitFor(() => expect(actions).toEqual(["abort:run-1"]));
    finishRun();
    await shutdown;

    expect(actions).toEqual(["abort:run-1", "close"]);
  });

  it("force-closes App Server after the shutdown grace expires", async () => {
    vi.useFakeTimers();
    const actions: string[] = [];
    try {
      const shutdown = shutdownCodexRuntime({
        activeRunId: "run-hanging",
        activeRunFinished: new Promise<void>(() => undefined),
        abort: async (runId) => { actions.push(`abort:${runId}`); },
        close: async () => { actions.push("close"); },
        graceMs: 5_000
      });

      await vi.advanceTimersByTimeAsync(4_999);
      expect(actions).toEqual(["abort:run-hanging"]);
      await vi.advanceTimersByTimeAsync(1);
      await shutdown;
      expect(actions).toEqual(["abort:run-hanging", "close"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
