import {
  detectMediaCapabilities,
  isMissingCodexThreadError,
  type CodexAccountService
} from "@factory/agent-runtime";
import type {
  CodexAccountCommand,
  CodexAccountSnapshot,
  CodexCapabilitySnapshot,
  CodexThreadCleanupJob,
  SqliteCodexRuntimeStore
} from "@factory/records";

type AccountGateway = Pick<
  CodexAccountService,
  | "read"
  | "startChatGptLogin"
  | "cancelLogin"
  | "logout"
  | "listSkills"
  | "readProviderCapabilities"
>;

type RuntimeStore = Pick<
  SqliteCodexRuntimeStore,
  | "claimNextCommand"
  | "completeCommand"
  | "failCommand"
  | "setAccountSnapshot"
  | "setCapabilitySnapshot"
>;

type ThreadCleanupGateway = {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
};

type ThreadCleanupStore = Pick<
  SqliteCodexRuntimeStore,
  | "claimNextThreadCleanup"
  | "completeThreadCleanup"
  | "rescheduleThreadCleanup"
>;

const threadCleanupRequestTimeoutMs = 30_000;
const defaultThreadCleanupRetryDelayMs = 30_000;

const commandErrorMessages: Record<CodexAccountCommand["type"], string> = {
  "account.login.start": "无法启动 OpenAI 登录，请确认 Codex App Server 正常运行",
  "account.login.cancel": "无法取消 OpenAI 登录，请稍后重试",
  "account.logout": "无法退出 OpenAI 账户，请稍后重试",
  "account.refresh": "无法刷新 OpenAI 登录状态，请稍后重试"
};

const accountResult = (snapshot: CodexAccountSnapshot) => ({
  authenticated: snapshot.authenticated,
  accountType: snapshot.accountType,
  planType: snapshot.planType,
  requiresOpenaiAuth: snapshot.requiresOpenaiAuth,
  capturedAt: snapshot.capturedAt
});

export const markCodexAccountUnavailable = (
  store: Pick<SqliteCodexRuntimeStore, "setAccountSnapshot">
) => store.setAccountSnapshot({
  authenticated: false,
  accountType: null,
  email: null,
  planType: null,
  requiresOpenaiAuth: true
});

export const startCodexAccountHeartbeat = (
  refresh: () => Promise<unknown>,
  intervalMs = 15_000
) => {
  let active = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped || active) return;
    active = true;
    void refresh().catch(() => undefined).finally(() => {
      active = false;
    });
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
};

export async function shutdownCodexRuntime(options: {
  activeRunId: string | null;
  activeRunFinished: Promise<void>;
  abort(runId: string, reason: string): Promise<unknown>;
  close(): Promise<void>;
  graceMs?: number;
  onAbortError?: (error: unknown) => void;
}) {
  if (options.activeRunId) {
    void Promise.resolve()
      .then(() => options.abort(options.activeRunId!, "Worker 正在停止"))
      .catch((error: unknown) => options.onAbortError?.(error));

    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const graceExpired = new Promise<void>((resolve) => {
      graceTimer = setTimeout(resolve, Math.max(0, options.graceMs ?? 5_000));
    });
    await Promise.race([
      options.activeRunFinished.catch(() => undefined),
      graceExpired
    ]);
    if (graceTimer) clearTimeout(graceTimer);
  }
  await options.close();
}

export async function refreshCodexAccountSnapshot(
  account: AccountGateway,
  store: RuntimeStore,
  refreshToken = false
): Promise<CodexAccountSnapshot> {
  const live = await account.read(refreshToken);
  const chatGptAccount = live.account?.type === "chatgpt" ? live.account : null;
  return store.setAccountSnapshot({
    authenticated: live.authenticated && chatGptAccount !== null,
    accountType: chatGptAccount ? "chatgpt" : null,
    email: chatGptAccount?.email ?? null,
    planType: chatGptAccount?.planType ?? null,
    requiresOpenaiAuth: live.requiresOpenaiAuth
  });
}

export async function refreshCodexCapabilitySnapshot(
  account: AccountGateway,
  store: RuntimeStore,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<CodexCapabilitySnapshot> {
  const [skillsResult, providerResult] = await Promise.allSettled([
    account.listSkills(cwd),
    account.readProviderCapabilities()
  ]);
  const skills = skillsResult.status === "fulfilled" ? skillsResult.value : [];
  const providerCapabilities = providerResult.status === "fulfilled"
    ? providerResult.value
    : null;
  return store.setCapabilitySnapshot({
    capabilities: detectMediaCapabilities(skills, providerCapabilities, environment)
  });
}

export async function refreshCodexRuntimeSnapshots(options: {
  account: AccountGateway;
  store: RuntimeStore;
  cwd: string;
  refreshToken?: boolean;
  environment?: NodeJS.ProcessEnv;
}) {
  const account = await refreshCodexAccountSnapshot(
    options.account,
    options.store,
    options.refreshToken ?? false
  );
  const capabilities = await refreshCodexCapabilitySnapshot(
    options.account,
    options.store,
    options.cwd,
    options.environment
  );
  return { account, capabilities };
}

const requireLoginId = (command: CodexAccountCommand) => {
  const loginId = command.payload.loginId;
  if (typeof loginId !== "string" || !loginId.trim()) {
    throw new Error("登录任务无效");
  }
  return loginId.trim();
};

async function executeAccountCommand(
  command: CodexAccountCommand,
  account: AccountGateway,
  store: RuntimeStore,
  cwd: string,
  environment: NodeJS.ProcessEnv
): Promise<Record<string, unknown>> {
  if (command.type === "account.login.start") {
    return account.startChatGptLogin();
  }
  if (command.type === "account.login.cancel") {
    await account.cancelLogin(requireLoginId(command));
    const snapshot = await refreshCodexAccountSnapshot(account, store);
    return { cancelled: true, ...accountResult(snapshot) };
  }
  if (command.type === "account.logout") {
    await account.logout();
    const snapshot = await refreshCodexAccountSnapshot(account, store);
    return { loggedOut: !snapshot.authenticated, ...accountResult(snapshot) };
  }

  const snapshots = await refreshCodexRuntimeSnapshots({
    account,
    store,
    cwd,
    refreshToken: true,
    environment
  });
  return {
    refreshed: true,
    ...accountResult(snapshots.account),
    mediaCapabilities: snapshots.capabilities.capabilities
  };
}

export async function processNextCodexAccountCommand(options: {
  workerId: string;
  account: AccountGateway;
  store: RuntimeStore;
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  onError?: (command: CodexAccountCommand, error: unknown) => void;
}) {
  const command = options.store.claimNextCommand(options.workerId);
  if (!command) return false;

  try {
    const result = await executeAccountCommand(
      command,
      options.account,
      options.store,
      options.cwd,
      options.environment ?? process.env
    );
    options.store.completeCommand(command.id, result);
  } catch (error) {
    options.onError?.(command, error);
    options.store.failCommand(command.id, commandErrorMessages[command.type]);
  }
  return true;
}

export async function processNextCodexThreadCleanup(options: {
  workerId: string;
  client: ThreadCleanupGateway;
  store: ThreadCleanupStore;
  retryDelayMs?: number;
  onError?: (job: CodexThreadCleanupJob, error: unknown) => void;
}) {
  const job = options.store.claimNextThreadCleanup(options.workerId);
  if (!job) return false;

  try {
    await options.client.request(
      "thread/delete",
      { threadId: job.threadId },
      threadCleanupRequestTimeoutMs
    );
  } catch (error) {
    if (!isMissingCodexThreadError(error)) {
      options.onError?.(job, error);
      const configuredDelay = options.retryDelayMs ?? defaultThreadCleanupRetryDelayMs;
      const retryDelayMs = Number.isFinite(configuredDelay)
        ? Math.min(Math.max(0, configuredDelay), 24 * 60 * 60_000)
        : defaultThreadCleanupRetryDelayMs;
      const errorType = error instanceof Error ? error.name : "unknown";
      options.store.rescheduleThreadCleanup(
        job.id,
        `Codex Thread 删除失败（${errorType}）`,
        new Date(Date.now() + retryDelayMs).toISOString()
      );
      return true;
    }
  }

  options.store.completeThreadCleanup(job.id);
  return true;
}
