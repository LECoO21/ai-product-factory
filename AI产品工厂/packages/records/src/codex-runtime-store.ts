import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { mediaCapabilitySchema, type MediaCapability } from "@factory/shared";
import { defaultDatabasePath } from "./database-path";
import { migrateFactoryDatabase } from "./migrations";

export const codexAccountCommandTypes = [
  "account.login.start",
  "account.login.cancel",
  "account.logout",
  "account.refresh"
] as const;

export type CodexAccountCommandType = (typeof codexAccountCommandTypes)[number];

export type CodexAccountSnapshot = {
  authenticated: boolean;
  accountType: "chatgpt" | null;
  emailHint: string | null;
  planType: string | null;
  requiresOpenaiAuth: boolean;
  capturedAt: string;
  updatedAt: string;
};

export type SetCodexAccountSnapshotInput = {
  authenticated: boolean;
  accountType?: "chatgpt" | null;
  email?: string | null;
  planType?: string | null;
  requiresOpenaiAuth: boolean;
  capturedAt?: string;
};

export type CodexMediaCapability = MediaCapability;

export type CodexCapabilitySnapshot = {
  capabilities: CodexMediaCapability[];
  capturedAt: string;
  updatedAt: string;
};

export type SetCodexCapabilitySnapshotInput = {
  capabilities: CodexMediaCapability[];
  capturedAt?: string;
};

export type CodexAccountCommandStatus = "pending" | "running" | "completed" | "failed";

export type CodexThreadCleanupStatus = "pending" | "running";

export type CodexThreadCleanupJob = {
  id: string;
  productFlowId: string;
  scopeId: string;
  threadId: string;
  status: CodexThreadCleanupStatus;
  workerId: string | null;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CodexAccountCommand = {
  id: string;
  type: CodexAccountCommandType;
  payload: Record<string, unknown>;
  status: CodexAccountCommandStatus;
  workerId: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CodexThreadBinding = {
  scopeId: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
};

export type CodexTurnBinding = {
  runId: string;
  threadId: string;
  turnId: string;
  createdAt: string;
  updatedAt: string;
};

type AccountSnapshotRow = {
  authenticated: number;
  account_type: "chatgpt" | null;
  email_hint: string | null;
  plan_type: string | null;
  requires_openai_auth: number;
  captured_at: string;
  updated_at: string;
};

type CapabilitySnapshotRow = {
  capabilities_json: string;
  captured_at: string;
  updated_at: string;
};

type AccountCommandRow = {
  id: string;
  type: CodexAccountCommandType;
  payload_json: string;
  status: CodexAccountCommandStatus;
  worker_id: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ThreadBindingRow = {
  scope_id: string;
  thread_id: string;
  created_at: string;
  updated_at: string;
};

type TurnBindingRow = {
  run_id: string;
  thread_id: string;
  turn_id: string;
  created_at: string;
  updated_at: string;
};

type ThreadCleanupRow = {
  id: string;
  product_flow_id: string;
  scope_id: string;
  thread_id: string;
  status: CodexThreadCleanupStatus;
  worker_id: string | null;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const sensitiveKeyPattern = /(token|secret|password|api[_-]?key|authorization|credential)/i;
const accountCommandTypeSet = new Set<CodexAccountCommandType>(codexAccountCommandTypes);

const requireNonEmpty = (value: string, label: string): string => {
  if (value.trim().length === 0) throw new Error(`${label} 不能为空`);
  return value;
};

const validateCapturedAt = (value: string): string => {
  if (Number.isNaN(Date.parse(value))) throw new Error("capturedAt 必须是有效时间");
  return value;
};

const assertSafeJsonValue = (
  value: unknown,
  label: string,
  ancestors = new WeakSet<object>()
): void => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} 只能包含有限数字`);
    return;
  }
  if (typeof value !== "object") throw new Error(`${label} 必须是可序列化 JSON`);
  if (ancestors.has(value)) throw new Error(`${label} 不能包含循环引用`);

  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeJsonValue(item, `${label}[${index}]`, ancestors));
  } else {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (sensitiveKeyPattern.test(key)) {
        throw new Error(`${label} 不得包含敏感字段：${key}`);
      }
      assertSafeJsonValue(nestedValue, `${label}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
};

const serializeSafeRecord = (value: Record<string, unknown>, label: string): string => {
  if (Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  assertSafeJsonValue(value, label);
  return JSON.stringify(value);
};

const parseRecord = (value: string, label: string): Record<string, unknown> => {
  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 不是有效对象`);
  }
  return parsed as Record<string, unknown>;
};

const maskEmail = (email: string): string => {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return "***";

  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const dot = domain.indexOf(".");
  const domainName = dot === -1 ? domain : domain.slice(0, dot);
  const suffix = dot === -1 ? "" : domain.slice(dot);
  return `${local[0] ?? "*"}***@${domainName[0] ?? "*"}***${suffix}`;
};

const normalizeCapabilities = (
  capabilities: unknown[],
  allowLegacyAvailable = false
): CodexMediaCapability[] => {
  const seen = new Set<CodexMediaCapability["kind"]>();
  return capabilities.map((rawCapability) => {
    const legacy = rawCapability && typeof rawCapability === "object" && !Array.isArray(rawCapability)
      ? rawCapability as Record<string, unknown>
      : null;
    const candidate = allowLegacyAvailable && legacy?.status === "available"
      ? { ...legacy, status: "attemptable" }
      : rawCapability;
    const parsed = mediaCapabilitySchema.safeParse(candidate);
    if (!parsed.success) throw new Error("素材能力快照格式无效");
    const capability = parsed.data;
    if (seen.has(capability.kind)) throw new Error(`素材能力重复：${capability.kind}`);
    seen.add(capability.kind);
    return capability;
  });
};

const toAccountSnapshot = (row: AccountSnapshotRow): CodexAccountSnapshot => ({
  authenticated: row.authenticated === 1,
  accountType: row.account_type,
  emailHint: row.email_hint,
  planType: row.plan_type,
  requiresOpenaiAuth: row.requires_openai_auth === 1,
  capturedAt: row.captured_at,
  updatedAt: row.updated_at
});

const toAccountCommand = (row: AccountCommandRow): CodexAccountCommand => ({
  id: row.id,
  type: row.type,
  payload: parseRecord(row.payload_json, "命令 payload"),
  status: row.status,
  workerId: row.worker_id,
  result: row.result_json === null ? null : parseRecord(row.result_json, "命令 result"),
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at
});

const toThreadBinding = (row: ThreadBindingRow): CodexThreadBinding => ({
  scopeId: row.scope_id,
  threadId: row.thread_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const toTurnBinding = (row: TurnBindingRow): CodexTurnBinding => ({
  runId: row.run_id,
  threadId: row.thread_id,
  turnId: row.turn_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const toThreadCleanupJob = (row: ThreadCleanupRow): CodexThreadCleanupJob => ({
  id: row.id,
  productFlowId: row.product_flow_id,
  scopeId: row.scope_id,
  threadId: row.thread_id,
  status: row.status,
  workerId: row.worker_id,
  attempts: row.attempts,
  nextAttemptAt: row.next_attempt_at,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export class SqliteCodexRuntimeStore {
  private readonly database: Database.Database;

  constructor(databasePath = defaultDatabasePath()) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    migrateFactoryDatabase(this.database, databasePath);
  }

  close(): void {
    this.database.close();
  }

  getAccountSnapshot(): CodexAccountSnapshot | null {
    const row = this.database
      .prepare("SELECT * FROM codex_account_snapshot WHERE id = 1")
      .get() as AccountSnapshotRow | undefined;
    return row ? toAccountSnapshot(row) : null;
  }

  setAccountSnapshot(input: SetCodexAccountSnapshotInput): CodexAccountSnapshot {
    const capturedAt = validateCapturedAt(input.capturedAt ?? new Date().toISOString());
    const updatedAt = new Date().toISOString();
    const accountType = input.authenticated ? (input.accountType ?? "chatgpt") : null;
    const email = input.authenticated ? (input.email?.trim() || null) : null;
    const emailHint = email === null ? null : maskEmail(email);
    const emailSha256 =
      email === null ? null : createHash("sha256").update(email.toLowerCase()).digest("hex");
    const planType = input.authenticated ? (input.planType ?? null) : null;

    this.database
      .prepare(
        `INSERT INTO codex_account_snapshot (
          id, authenticated, account_type, email_hint, email_sha256, plan_type,
          requires_openai_auth, captured_at, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          authenticated = excluded.authenticated,
          account_type = excluded.account_type,
          email_hint = excluded.email_hint,
          email_sha256 = excluded.email_sha256,
          plan_type = excluded.plan_type,
          requires_openai_auth = excluded.requires_openai_auth,
          captured_at = excluded.captured_at,
          updated_at = excluded.updated_at`
      )
      .run(
        input.authenticated ? 1 : 0,
        accountType,
        emailHint,
        emailSha256,
        planType,
        input.requiresOpenaiAuth ? 1 : 0,
        capturedAt,
        updatedAt
      );
    return this.getAccountSnapshot()!;
  }

  getCapabilitySnapshot(): CodexCapabilitySnapshot | null {
    const row = this.database
      .prepare("SELECT * FROM codex_capability_snapshot WHERE id = 1")
      .get() as CapabilitySnapshotRow | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.capabilities_json) as unknown;
    if (!Array.isArray(parsed)) throw new Error("素材能力快照格式无效");
    return {
      capabilities: normalizeCapabilities(parsed, true),
      capturedAt: row.captured_at,
      updatedAt: row.updated_at
    };
  }

  setCapabilitySnapshot(input: SetCodexCapabilitySnapshotInput): CodexCapabilitySnapshot {
    const capabilities = normalizeCapabilities(input.capabilities);
    assertSafeJsonValue(capabilities, "素材能力快照");
    const capturedAt = validateCapturedAt(input.capturedAt ?? new Date().toISOString());
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO codex_capability_snapshot (
          id, capabilities_json, captured_at, updated_at
        ) VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          capabilities_json = excluded.capabilities_json,
          captured_at = excluded.captured_at,
          updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(capabilities), capturedAt, updatedAt);
    return this.getCapabilitySnapshot()!;
  }

  createCommand(input: {
    type: CodexAccountCommandType;
    payload: Record<string, unknown>;
  }): CodexAccountCommand {
    if (!accountCommandTypeSet.has(input.type)) {
      throw new Error(`未知 Codex 账户命令：${String(input.type)}`);
    }
    const payloadJson = serializeSafeRecord(input.payload, "命令 payload");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO codex_account_commands (
          id, type, payload_json, status, worker_id, result_json, error,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?, NULL)`
      )
      .run(id, input.type, payloadJson, now, now);
    return this.getCommand(id)!;
  }

  getCommand(id: string): CodexAccountCommand | null {
    const row = this.database
      .prepare("SELECT * FROM codex_account_commands WHERE id = ?")
      .get(id) as AccountCommandRow | undefined;
    return row ? toAccountCommand(row) : null;
  }

  claimNextCommand(workerId: string): CodexAccountCommand | null {
    requireNonEmpty(workerId, "workerId");
    const claim = this.database.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT id FROM codex_account_commands
           WHERE status = 'pending'
           ORDER BY created_at ASC, rowid ASC
           LIMIT 1`
        )
        .get() as { id: string } | undefined;
      if (!row) return null;

      const result = this.database
        .prepare(
          `UPDATE codex_account_commands
           SET status = 'running', worker_id = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`
        )
        .run(workerId, new Date().toISOString(), row.id);
      return result.changes === 1 ? this.getCommand(row.id) : null;
    });
    return claim.immediate();
  }

  failRunningCommandsForRecovery(error: string): CodexAccountCommand[] {
    requireNonEmpty(error, "error");
    const recover = this.database.transaction(() => {
      const rows = this.database
        .prepare(
          `SELECT id FROM codex_account_commands
           WHERE status = 'running'
           ORDER BY created_at ASC, rowid ASC`
        )
        .all() as Array<{ id: string }>;
      if (rows.length === 0) return [];

      const now = new Date().toISOString();
      const update = this.database.prepare(
        `UPDATE codex_account_commands
         SET status = 'failed', result_json = NULL, error = ?,
             updated_at = ?, completed_at = ?
         WHERE id = ? AND status = 'running'`
      );
      for (const row of rows) update.run(error, now, now, row.id);
      return rows.map((row) => this.getRequiredCommand(row.id));
    });
    return recover.immediate();
  }

  completeCommand(id: string, result: Record<string, unknown>): CodexAccountCommand {
    const resultJson = serializeSafeRecord(result, "命令 result");
    const complete = this.database.transaction(() => {
      const command = this.getRequiredCommand(id);
      if (command.status === "completed") return command;
      if (command.status === "failed") throw new Error(`命令已经失败，不能标记完成：${id}`);
      if (command.status !== "running") throw new Error(`命令尚未领取：${id}`);

      const now = new Date().toISOString();
      const update = this.database
        .prepare(
          `UPDATE codex_account_commands
           SET status = 'completed', result_json = ?, error = NULL,
               updated_at = ?, completed_at = ?
           WHERE id = ? AND status = 'running'`
        )
        .run(resultJson, now, now, id);
      if (update.changes !== 1) throw new Error(`命令完成状态冲突：${id}`);
      return this.getRequiredCommand(id);
    });
    return complete.immediate();
  }

  failCommand(id: string, error: string): CodexAccountCommand {
    requireNonEmpty(error, "error");
    const fail = this.database.transaction(() => {
      const command = this.getRequiredCommand(id);
      if (command.status === "failed") return command;
      if (command.status === "completed") throw new Error(`命令已经完成，不能标记失败：${id}`);
      if (command.status !== "running") throw new Error(`命令尚未领取：${id}`);

      const now = new Date().toISOString();
      const update = this.database
        .prepare(
          `UPDATE codex_account_commands
           SET status = 'failed', result_json = NULL, error = ?,
               updated_at = ?, completed_at = ?
           WHERE id = ? AND status = 'running'`
        )
        .run(error, now, now, id);
      if (update.changes !== 1) throw new Error(`命令失败状态冲突：${id}`);
      return this.getRequiredCommand(id);
    });
    return fail.immediate();
  }

  saveThreadBinding(scopeId: string, threadId: string): CodexThreadBinding {
    requireNonEmpty(scopeId, "scopeId");
    requireNonEmpty(threadId, "threadId");
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO codex_thread_bindings (scope_id, thread_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope_id) DO UPDATE SET
           thread_id = excluded.thread_id,
           updated_at = excluded.updated_at`
      )
      .run(scopeId, threadId, now, now);
    return this.getThreadBinding(scopeId)!;
  }

  getThreadBinding(scopeId: string): CodexThreadBinding | null {
    const row = this.database
      .prepare("SELECT * FROM codex_thread_bindings WHERE scope_id = ?")
      .get(scopeId) as ThreadBindingRow | undefined;
    return row ? toThreadBinding(row) : null;
  }

  deleteThreadBinding(scopeId: string, expectedThreadId: string): boolean {
    requireNonEmpty(scopeId, "scopeId");
    requireNonEmpty(expectedThreadId, "expectedThreadId");
    return this.database
      .prepare("DELETE FROM codex_thread_bindings WHERE scope_id = ? AND thread_id = ?")
      .run(scopeId, expectedThreadId).changes === 1;
  }

  saveTurnBinding(runId: string, threadId: string, turnId: string): CodexTurnBinding {
    requireNonEmpty(runId, "runId");
    requireNonEmpty(threadId, "threadId");
    requireNonEmpty(turnId, "turnId");
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO codex_turn_bindings (run_id, thread_id, turn_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           thread_id = excluded.thread_id,
           turn_id = excluded.turn_id,
           updated_at = excluded.updated_at`
      )
      .run(runId, threadId, turnId, now, now);
    return this.getTurnBinding(runId)!;
  }

  getTurnBinding(runId: string): CodexTurnBinding | null {
    const row = this.database
      .prepare("SELECT * FROM codex_turn_bindings WHERE run_id = ?")
      .get(runId) as TurnBindingRow | undefined;
    return row ? toTurnBinding(row) : null;
  }

  enqueueProductThreadCleanups(productFlowId: string): CodexThreadCleanupJob[] {
    const normalizedId = requireNonEmpty(productFlowId, "productFlowId").trim();
    const enqueue = this.database.transaction(() => {
      const bindings = this.database
        .prepare("SELECT scope_id, thread_id FROM codex_thread_bindings WHERE scope_id = ?")
        .all(normalizedId) as Array<{ scope_id: string; thread_id: string }>;
      const hasProductionRuns = this.database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'production_runs'")
        .get();
      const hasHarnessRuns = this.database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'harness_runs'")
        .get();
      if (hasProductionRuns && hasHarnessRuns) {
        bindings.push(...this.database.prepare(
          `SELECT binding.scope_id, binding.thread_id
           FROM codex_thread_bindings AS binding
           JOIN harness_runs AS harness
             ON binding.scope_id = 'harness:' || harness.id
           JOIN production_runs AS production
             ON production.id = harness.production_run_id
           WHERE production.project_id = ?`
        ).all(normalizedId) as Array<{ scope_id: string; thread_id: string }>);
      }

      const uniqueBindings = [...new Map(
        bindings.map((binding) => [`${binding.scope_id}\0${binding.thread_id}`, binding])
      ).values()].sort((left, right) => left.scope_id.localeCompare(right.scope_id));
      const now = new Date().toISOString();
      const insert = this.database.prepare(
        `INSERT INTO codex_thread_cleanup_jobs (
          id, product_flow_id, scope_id, thread_id, status, worker_id, attempts,
          next_attempt_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', NULL, 0, ?, NULL, ?, ?)
        ON CONFLICT(scope_id, thread_id) DO NOTHING`
      );
      for (const binding of uniqueBindings) {
        insert.run(
          randomUUID(),
          normalizedId,
          binding.scope_id,
          binding.thread_id,
          now,
          now,
          now
        );
      }
      const getByBinding = this.database.prepare(
        `SELECT * FROM codex_thread_cleanup_jobs
         WHERE scope_id = ? AND thread_id = ?`
      );
      return uniqueBindings.map((binding) => toThreadCleanupJob(
        getByBinding.get(binding.scope_id, binding.thread_id) as ThreadCleanupRow
      ));
    });
    return enqueue.immediate();
  }

  claimNextThreadCleanup(workerId: string): CodexThreadCleanupJob | null {
    const normalizedWorkerId = requireNonEmpty(workerId, "workerId").trim();
    const claim = this.database.transaction(() => {
      const now = new Date().toISOString();
      const row = this.database.prepare(
        `SELECT id FROM codex_thread_cleanup_jobs
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC, created_at ASC, id ASC
         LIMIT 1`
      ).get(now) as { id: string } | undefined;
      if (!row) return null;
      const result = this.database.prepare(
        `UPDATE codex_thread_cleanup_jobs
         SET status = 'running', worker_id = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      ).run(normalizedWorkerId, now, row.id);
      return result.changes === 1 ? this.getRequiredThreadCleanup(row.id) : null;
    });
    return claim.immediate();
  }

  recoverRunningThreadCleanups(): CodexThreadCleanupJob[] {
    const recover = this.database.transaction(() => {
      const rows = this.database.prepare(
        `SELECT id FROM codex_thread_cleanup_jobs
         WHERE status = 'running'
         ORDER BY created_at ASC, id ASC`
      ).all() as Array<{ id: string }>;
      if (rows.length === 0) return [];

      const now = new Date().toISOString();
      const update = this.database.prepare(
        `UPDATE codex_thread_cleanup_jobs
         SET status = 'pending', worker_id = NULL, updated_at = ?
         WHERE id = ? AND status = 'running'`
      );
      const recovered: CodexThreadCleanupJob[] = [];
      for (const row of rows) {
        if (update.run(now, row.id).changes === 1) {
          recovered.push(this.getRequiredThreadCleanup(row.id));
        }
      }
      return recovered;
    });
    return recover.immediate();
  }

  rescheduleThreadCleanup(
    id: string,
    error: string,
    nextAttemptAt: string
  ): CodexThreadCleanupJob {
    const normalizedError = requireNonEmpty(error, "error").trim().slice(0, 2_000);
    if (Number.isNaN(Date.parse(nextAttemptAt))) {
      throw new Error("nextAttemptAt 必须是有效时间");
    }
    const normalizedNextAttemptAt = new Date(nextAttemptAt).toISOString();
    const reschedule = this.database.transaction(() => {
      const job = this.getRequiredThreadCleanup(id);
      if (job.status !== "running") throw new Error(`Codex Thread 清理任务尚未领取：${id}`);
      const update = this.database.prepare(
        `UPDATE codex_thread_cleanup_jobs
         SET status = 'pending', worker_id = NULL, next_attempt_at = ?,
             last_error = ?, updated_at = ?
         WHERE id = ? AND status = 'running'`
      ).run(normalizedNextAttemptAt, normalizedError, new Date().toISOString(), id);
      if (update.changes !== 1) throw new Error(`Codex Thread 清理重试状态冲突：${id}`);
      return this.getRequiredThreadCleanup(id);
    });
    return reschedule.immediate();
  }

  completeThreadCleanup(id: string) {
    const complete = this.database.transaction(() => {
      const job = this.getRequiredThreadCleanup(id);
      if (job.status !== "running") throw new Error(`Codex Thread 清理任务尚未领取：${id}`);
      const threadBindingDeleted = this.database.prepare(
        "DELETE FROM codex_thread_bindings WHERE scope_id = ? AND thread_id = ?"
      ).run(job.scopeId, job.threadId).changes === 1;
      const turnBindingsDeleted = this.database.prepare(
        "DELETE FROM codex_turn_bindings WHERE thread_id = ?"
      ).run(job.threadId).changes;
      const deleted = this.database.prepare(
        "DELETE FROM codex_thread_cleanup_jobs WHERE id = ? AND status = 'running'"
      ).run(id);
      if (deleted.changes !== 1) throw new Error(`Codex Thread 清理完成状态冲突：${id}`);
      return {
        jobId: job.id,
        scopeId: job.scopeId,
        threadId: job.threadId,
        threadBindingDeleted,
        turnBindingsDeleted
      };
    });
    return complete.immediate();
  }

  private getRequiredCommand(id: string): CodexAccountCommand {
    const command = this.getCommand(id);
    if (!command) throw new Error(`Codex 账户命令不存在：${id}`);
    return command;
  }

  private getRequiredThreadCleanup(id: string): CodexThreadCleanupJob {
    const row = this.database
      .prepare("SELECT * FROM codex_thread_cleanup_jobs WHERE id = ?")
      .get(id) as ThreadCleanupRow | undefined;
    if (!row) throw new Error(`Codex Thread 清理任务不存在：${id}`);
    return toThreadCleanupJob(row);
  }
}
