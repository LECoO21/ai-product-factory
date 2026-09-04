import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  approvalRequestSchema,
  artifactSchema,
  backgroundJobSchema,
  evidenceSchema,
  factoryTaskSchema,
  harnessCheckpointSchema,
  harnessRoundSchema,
  harnessRunSchema,
  toolInvocationSchema,
  workPlanItemSchema,
  type ApprovalRequest,
  type Artifact,
  type BackgroundJob,
  type Evidence,
  type FactoryTask,
  type HarnessCheckpoint,
  type HarnessRound,
  type HarnessRun,
  type HarnessRunStatus,
  type PermissionLevel,
  type ToolInvocation,
  type ToolInvocationStatus,
  type WorkPlanItem
} from "@factory/shared";
import { defaultDatabasePath } from "./index";
import { migrateFactoryDatabase } from "./migrations";

type TaskRow = {
  id: string; run_id: string; objective: string; status: FactoryTask["status"];
  attempt: number; max_attempts: number; worker_id: string | null; error: string | null;
  expires_at: string | null; created_at: string; updated_at: string;
};
type HarnessRunRow = {
  id: string; production_run_id: string; task_id: string; session_path: string;
  prompt_version: string; model: string; status: HarnessRunStatus; stop_reason: string | null;
  tool_calls: number; started_at: string | null; completed_at: string | null;
  created_at: string; updated_at: string;
};
type PlanRow = {
  id: string; harness_run_id: string; position: number; text: string;
  status: WorkPlanItem["status"]; created_at: string; updated_at: string;
};
type InvocationRow = {
  id: string; harness_run_id: string; tool_call_id: string; tool_name: string;
  args_json: string; permission: PermissionLevel; status: ToolInvocationStatus;
  result_json: string | null; started_at: string; completed_at: string | null;
};
type ArtifactRow = {
  id: string; run_id: string; kind: string; path: string; sha256: string;
  mime_type: string; size: number; status: Artifact["status"];
  source_tool_call_id: string | null; created_at: string;
};
type EvidenceRow = {
  id: string; run_id: string; criterion_id: string; kind: string;
  artifact_id: string | null; observation_json: string; passed: number; created_at: string;
};
type BackgroundJobRow = {
  id: string; task_id: string; kind: string; pid: number | null; status: BackgroundJob["status"];
  command_summary: string; exit_code: number | null; stdout_path: string | null;
  stderr_path: string | null; created_at: string; updated_at: string;
};
type HarnessRoundRow = {
  id: string; harness_run_id: string; round: number; decision: string;
  satisfied_json: string; missing_json: string; failed_json: string;
  next_action: string; created_at: string;
};
type ApprovalRequestRow = {
  id: string; harness_run_id: string; tool_call_id: string; tool_name: string;
  args_json: string; args_fingerprint: string; status: ApprovalRequest["status"];
  decided_at: string | null; created_at: string;
};
type HarnessCheckpointRow = {
  id: string; harness_run_id: string; kind: string; status: string;
  payload_json: string; created_at: string;
};

const toTask = (row: TaskRow) => factoryTaskSchema.parse({
  id: row.id, runId: row.run_id, objective: row.objective, status: row.status,
  attempt: row.attempt, maxAttempts: row.max_attempts, workerId: row.worker_id,
  error: row.error, expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at
});
const toHarnessRun = (row: HarnessRunRow) => harnessRunSchema.parse({
  id: row.id, productionRunId: row.production_run_id, taskId: row.task_id,
  sessionPath: row.session_path, promptVersion: row.prompt_version, model: row.model,
  status: row.status, stopReason: row.stop_reason, toolCalls: row.tool_calls,
  startedAt: row.started_at, completedAt: row.completed_at,
  createdAt: row.created_at, updatedAt: row.updated_at
});
const toPlan = (row: PlanRow) => workPlanItemSchema.parse({
  id: row.id, harnessRunId: row.harness_run_id, position: row.position, text: row.text,
  status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
});
const toInvocation = (row: InvocationRow) => toolInvocationSchema.parse({
  id: row.id, harnessRunId: row.harness_run_id, toolCallId: row.tool_call_id,
  toolName: row.tool_name, args: JSON.parse(row.args_json), permission: row.permission,
  status: row.status, result: row.result_json ? JSON.parse(row.result_json) : null,
  startedAt: row.started_at, completedAt: row.completed_at
});
const toArtifact = (row: ArtifactRow) => artifactSchema.parse({
  id: row.id, runId: row.run_id, kind: row.kind, path: row.path, sha256: row.sha256,
  mimeType: row.mime_type, size: row.size, status: row.status,
  sourceToolCallId: row.source_tool_call_id, createdAt: row.created_at
});
const toEvidence = (row: EvidenceRow) => evidenceSchema.parse({
  id: row.id, runId: row.run_id, criterionId: row.criterion_id, kind: row.kind,
  artifactId: row.artifact_id, observation: JSON.parse(row.observation_json),
  passed: row.passed === 1, createdAt: row.created_at
});
const toBackgroundJob = (row: BackgroundJobRow) => backgroundJobSchema.parse({
  id: row.id, taskId: row.task_id, kind: row.kind, pid: row.pid, status: row.status,
  commandSummary: row.command_summary, exitCode: row.exit_code, stdoutPath: row.stdout_path,
  stderrPath: row.stderr_path, createdAt: row.created_at, updatedAt: row.updated_at
});
const toHarnessRound = (row: HarnessRoundRow) => harnessRoundSchema.parse({
  id: row.id, harnessRunId: row.harness_run_id, round: row.round, decision: row.decision,
  satisfied: JSON.parse(row.satisfied_json), missing: JSON.parse(row.missing_json),
  failed: JSON.parse(row.failed_json), nextAction: row.next_action, createdAt: row.created_at
});
const toApprovalRequest = (row: ApprovalRequestRow) => approvalRequestSchema.parse({
  id: row.id, harnessRunId: row.harness_run_id, toolCallId: row.tool_call_id,
  toolName: row.tool_name, args: JSON.parse(row.args_json),
  argsFingerprint: row.args_fingerprint, status: row.status,
  decidedAt: row.decided_at, createdAt: row.created_at
});
const toHarnessCheckpoint = (row: HarnessCheckpointRow) => harnessCheckpointSchema.parse({
  id: row.id, harnessRunId: row.harness_run_id, kind: row.kind, status: row.status,
  payload: JSON.parse(row.payload_json), createdAt: row.created_at
});

export class SqliteHarnessRecordStore {
  private readonly database: Database.Database;

  constructor(databasePath = defaultDatabasePath()) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    migrateFactoryDatabase(this.database, databasePath);
  }

  createTask(runId: string, objective: string, maxAttempts = 2): FactoryTask {
    const now = new Date().toISOString();
    const task = factoryTaskSchema.parse({ id: randomUUID(), runId, objective, status: "pending",
      attempt: 1, maxAttempts, workerId: null, error: null, expiresAt: null, createdAt: now, updatedAt: now });
    this.database.prepare(`INSERT INTO factory_tasks
      (id, run_id, objective, status, attempt, max_attempts, worker_id, error, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`)
      .run(task.id, task.runId, task.objective, task.status, task.attempt, task.maxAttempts, now, now);
    return task;
  }

  getTask(id: string): FactoryTask | null {
    const row = this.database.prepare("SELECT * FROM factory_tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  getTaskForRun(runId: string): FactoryTask | null {
    const row = this.database.prepare(
      "SELECT * FROM factory_tasks WHERE run_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(runId) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  updateTask(id: string, status: FactoryTask["status"], error: string | null = null): FactoryTask {
    const result = this.database.prepare(
      "UPDATE factory_tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?"
    ).run(status, error, new Date().toISOString(), id);
    if (result.changes !== 1) throw new Error(`Task 不存在：${id}`);
    return this.getTask(id)!;
  }

  claimTask(workerId: string, leaseMs = 5 * 60_000): FactoryTask | null {
    return this.database.transaction(() => {
      const row = this.database.prepare(
        "SELECT * FROM factory_tasks WHERE status = 'pending' ORDER BY created_at LIMIT 1"
      ).get() as TaskRow | undefined;
      if (!row) return null;
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + leaseMs).toISOString();
      const result = this.database.prepare(
        "UPDATE factory_tasks SET status = 'in_progress', worker_id = ?, expires_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
      ).run(workerId, expiresAt, now, row.id);
      if (result.changes !== 1) return null;
      return toTask(this.database.prepare("SELECT * FROM factory_tasks WHERE id = ?").get(row.id) as TaskRow);
    })();
  }

  renewTaskLease(id: string, leaseMs = 5 * 60_000): FactoryTask {
    const expiresAt = new Date(Date.now() + leaseMs).toISOString();
    const result = this.database.prepare(
      "UPDATE factory_tasks SET expires_at = ?, updated_at = ? WHERE id = ?"
    ).run(expiresAt, new Date().toISOString(), id);
    if (result.changes !== 1) throw new Error(`Task 不存在：${id}`);
    return this.getTask(id)!;
  }

  recoverExpiredTasks(now = new Date().toISOString()): FactoryTask[] {
    const expired = this.database.prepare(
      "SELECT * FROM factory_tasks WHERE status = 'in_progress' AND expires_at IS NOT NULL AND expires_at < ? ORDER BY created_at"
    ).all(now) as TaskRow[];
    const recovered: FactoryTask[] = [];
    for (const row of expired) {
      this.database.prepare(
        "UPDATE factory_tasks SET status = 'pending', worker_id = NULL, expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'in_progress'"
      ).run(new Date().toISOString(), row.id);
      recovered.push(this.getTask(row.id)!);
    }
    return recovered;
  }

  createHarnessRun(input: Omit<HarnessRun, "id" | "status" | "stopReason" | "toolCalls" | "startedAt" | "completedAt" | "createdAt" | "updatedAt">): HarnessRun {
    const now = new Date().toISOString();
    const run = harnessRunSchema.parse({ ...input, id: randomUUID(), status: "ready",
      stopReason: null, toolCalls: 0, startedAt: null, completedAt: null, createdAt: now, updatedAt: now });
    this.database.prepare(`INSERT INTO harness_runs
      (id, production_run_id, task_id, session_path, prompt_version, model, status, stop_reason,
       tool_calls, started_at, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, NULL, ?, ?)`)
      .run(run.id, run.productionRunId, run.taskId, run.sessionPath, run.promptVersion, run.model, run.status, now, now);
    return run;
  }

  getHarnessRun(id: string): HarnessRun | null {
    const row = this.database.prepare("SELECT * FROM harness_runs WHERE id = ?").get(id) as HarnessRunRow | undefined;
    return row ? toHarnessRun(row) : null;
  }

  getHarnessRunForProductionRun(productionRunId: string): HarnessRun | null {
    const row = this.database.prepare(
      "SELECT * FROM harness_runs WHERE production_run_id = ?"
    ).get(productionRunId) as HarnessRunRow | undefined;
    return row ? toHarnessRun(row) : null;
  }

  transitionHarnessRun(id: string, status: HarnessRunStatus, stopReason: string | null = null): HarnessRun {
    const now = new Date().toISOString();
    const terminal = ["succeeded", "failed", "cancelled", "interrupted"].includes(status);
    const result = this.database.prepare(`UPDATE harness_runs SET status = ?, stop_reason = ?,
      started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
      completed_at = CASE WHEN ? THEN ? ELSE completed_at END, updated_at = ? WHERE id = ?`)
      .run(status, stopReason, status, now, terminal ? 1 : 0, now, now, id);
    if (result.changes !== 1) throw new Error(`Harness 运行不存在：${id}`);
    return this.getHarnessRun(id)!;
  }

  replacePlan(harnessRunId: string, items: Array<{ id: string; text: string; status: WorkPlanItem["status"] }>): WorkPlanItem[] {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.prepare("DELETE FROM work_plan_items WHERE harness_run_id = ?").run(harnessRunId);
      const insert = this.database.prepare(`INSERT INTO work_plan_items
        (id, harness_run_id, position, text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      items.forEach((item, position) => insert.run(
        `${harnessRunId}:${item.id}`,
        harnessRunId,
        position,
        item.text,
        item.status,
        now,
        now
      ));
    })();
    return this.getPlan(harnessRunId);
  }

  getPlan(harnessRunId: string): WorkPlanItem[] {
    return (this.database.prepare(
      "SELECT * FROM work_plan_items WHERE harness_run_id = ? ORDER BY position"
    ).all(harnessRunId) as PlanRow[]).map(toPlan);
  }

  getInvocation(harnessRunId: string, toolCallId: string): ToolInvocation | null {
    const row = this.database.prepare(
      "SELECT * FROM tool_invocations WHERE harness_run_id = ? AND tool_call_id = ?"
    ).get(harnessRunId, toolCallId) as InvocationRow | undefined;
    return row ? toInvocation(row) : null;
  }

  startInvocation(input: { harnessRunId: string; toolCallId: string; toolName: string; args: Record<string, unknown>; permission: PermissionLevel }): ToolInvocation {
    const existing = this.getInvocation(input.harnessRunId, input.toolCallId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database.prepare(`INSERT INTO tool_invocations
      (id, harness_run_id, tool_call_id, tool_name, args_json, permission, status, result_json, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, 'started', NULL, ?, NULL)`)
      .run(id, input.harnessRunId, input.toolCallId, input.toolName, JSON.stringify(input.args), input.permission, now);
    return this.getInvocation(input.harnessRunId, input.toolCallId)!;
  }

  completeInvocation(harnessRunId: string, toolCallId: string, status: Exclude<ToolInvocationStatus, "started">, result: Record<string, unknown>): ToolInvocation {
    const existing = this.getInvocation(harnessRunId, toolCallId);
    if (!existing) throw new Error(`工具调用未登记：${toolCallId}`);
    if (existing.status !== "started") return existing;
    const now = new Date().toISOString();
    this.database.prepare(`UPDATE tool_invocations SET status = ?, result_json = ?, completed_at = ?
      WHERE harness_run_id = ? AND tool_call_id = ? AND status = 'started'`)
      .run(status, JSON.stringify(result), now, harnessRunId, toolCallId);
    return this.getInvocation(harnessRunId, toolCallId)!;
  }

  listInvocations(harnessRunId: string): ToolInvocation[] {
    return (this.database.prepare(
      "SELECT * FROM tool_invocations WHERE harness_run_id = ? ORDER BY rowid"
    ).all(harnessRunId) as InvocationRow[]).map(toInvocation);
  }

  registerArtifact(input: { runId: string; kind: string; path: string; mimeType: string; sourceToolCallId?: string | null }): Artifact {
    const content = readFileSync(input.path);
    const artifact = artifactSchema.parse({ id: randomUUID(), ...input,
      sourceToolCallId: input.sourceToolCallId ?? null,
      sha256: createHash("sha256").update(content).digest("hex"), size: statSync(input.path).size,
      status: "ready", createdAt: new Date().toISOString() });
    this.database.prepare(`INSERT INTO artifacts
      (id, run_id, kind, path, sha256, mime_type, size, status, source_tool_call_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(artifact.id, artifact.runId, artifact.kind, artifact.path, artifact.sha256,
        artifact.mimeType, artifact.size, artifact.status, artifact.sourceToolCallId, artifact.createdAt);
    return artifact;
  }

  listArtifacts(runId: string): Artifact[] {
    return (this.database.prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at").all(runId) as ArtifactRow[]).map(toArtifact);
  }

  getArtifact(id: string): Artifact | null {
    const row = this.database.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
    return row ? toArtifact(row) : null;
  }

  registerEvidence(input: { id?: string; runId: string; criterionId: string; kind: string; artifactId?: string | null; observation: Record<string, unknown>; passed: boolean }): Evidence {
    const id = input.id ?? randomUUID();
    const existing = this.database.prepare("SELECT id FROM evidence WHERE id = ?").get(id);
    if (existing) throw new Error(`证据不可覆盖：${id}`);
    const evidence = evidenceSchema.parse({ ...input, id, artifactId: input.artifactId ?? null,
      createdAt: new Date().toISOString() });
    this.database.prepare(`INSERT INTO evidence
      (id, run_id, criterion_id, kind, artifact_id, observation_json, passed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(evidence.id, evidence.runId, evidence.criterionId, evidence.kind, evidence.artifactId,
        JSON.stringify(evidence.observation), evidence.passed ? 1 : 0, evidence.createdAt);
    return evidence;
  }

  listEvidence(runId: string): Evidence[] {
    return (this.database.prepare("SELECT * FROM evidence WHERE run_id = ? ORDER BY created_at").all(runId) as EvidenceRow[]).map(toEvidence);
  }

  createBackgroundJob(input: { taskId: string; kind: string; commandSummary: string; stdoutPath?: string | null; stderrPath?: string | null }): BackgroundJob {
    const now = new Date().toISOString();
    const job = backgroundJobSchema.parse({ id: randomUUID(), ...input, pid: null, status: "queued",
      exitCode: null, stdoutPath: input.stdoutPath ?? null, stderrPath: input.stderrPath ?? null,
      createdAt: now, updatedAt: now });
    this.database.prepare(`INSERT INTO background_jobs
      (id, task_id, kind, pid, status, command_summary, exit_code, stdout_path, stderr_path, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)`)
      .run(job.id, job.taskId, job.kind, job.status, job.commandSummary, job.stdoutPath, job.stderrPath, now, now);
    return job;
  }

  getBackgroundJob(id: string): BackgroundJob | null {
    const row = this.database.prepare("SELECT * FROM background_jobs WHERE id = ?").get(id) as BackgroundJobRow | undefined;
    return row ? toBackgroundJob(row) : null;
  }

  updateBackgroundJob(id: string, status: BackgroundJob["status"], exitCode: number | null = null): BackgroundJob {
    const result = this.database.prepare(
      "UPDATE background_jobs SET status = ?, exit_code = ?, updated_at = ? WHERE id = ?"
    ).run(status, exitCode, new Date().toISOString(), id);
    if (result.changes !== 1) throw new Error(`后台任务不存在：${id}`);
    return this.getBackgroundJob(id)!;
  }

  interruptOrphanedBackgroundJobs(): number {
    return this.database.prepare(
      "UPDATE background_jobs SET status = 'interrupted', updated_at = ? WHERE status IN ('queued', 'running')"
    ).run(new Date().toISOString()).changes;
  }

  recordHarnessRound(input: {
    harnessRunId: string;
    round: number;
    decision: string;
    satisfied: string[];
    missing: string[];
    failed: string[];
    nextAction: string;
  }): HarnessRound {
    const now = new Date().toISOString();
    const harnessRound = harnessRoundSchema.parse({
      id: randomUUID(),
      harnessRunId: input.harnessRunId,
      round: input.round,
      decision: input.decision,
      satisfied: input.satisfied,
      missing: input.missing,
      failed: input.failed,
      nextAction: input.nextAction,
      createdAt: now
    });
    this.database.prepare(`INSERT INTO harness_rounds
      (id, harness_run_id, round, decision, satisfied_json, missing_json, failed_json, next_action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        harnessRound.id,
        harnessRound.harnessRunId,
        harnessRound.round,
        harnessRound.decision,
        JSON.stringify(harnessRound.satisfied),
        JSON.stringify(harnessRound.missing),
        JSON.stringify(harnessRound.failed),
        harnessRound.nextAction,
        harnessRound.createdAt
      );
    return harnessRound;
  }

  listHarnessRounds(harnessRunId: string): HarnessRound[] {
    return (this.database.prepare(
      "SELECT * FROM harness_rounds WHERE harness_run_id = ? ORDER BY round"
    ).all(harnessRunId) as HarnessRoundRow[]).map(toHarnessRound);
  }

  createApprovalRequest(input: {
    harnessRunId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    argsFingerprint: string;
  }): ApprovalRequest {
    const now = new Date().toISOString();
    const request = approvalRequestSchema.parse({
      id: randomUUID(),
      harnessRunId: input.harnessRunId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      args: input.args,
      argsFingerprint: input.argsFingerprint,
      status: "pending",
      decidedAt: null,
      createdAt: now
    });
    this.database.prepare(`INSERT INTO approval_requests
      (id, harness_run_id, tool_call_id, tool_name, args_json, args_fingerprint, status, decided_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`)
      .run(
        request.id,
        request.harnessRunId,
        request.toolCallId,
        request.toolName,
        JSON.stringify(request.args),
        request.argsFingerprint,
        request.createdAt
      );
    return request;
  }

  getApprovalDecision(
    harnessRunId: string,
    toolName: string,
    argsFingerprint: string
  ): "approved" | "denied" | null {
    const row = this.database.prepare(
      `SELECT status FROM approval_requests
       WHERE harness_run_id = ? AND tool_name = ? AND args_fingerprint = ?
         AND status IN ('approved', 'denied')
       ORDER BY created_at DESC LIMIT 1`
    ).get(harnessRunId, toolName, argsFingerprint) as { status: string } | undefined;
    return row ? (row.status as "approved" | "denied") : null;
  }

  listPendingApprovals(harnessRunId: string): ApprovalRequest[] {
    return (this.database.prepare(
      "SELECT * FROM approval_requests WHERE harness_run_id = ? AND status = 'pending' ORDER BY created_at"
    ).all(harnessRunId) as ApprovalRequestRow[]).map(toApprovalRequest);
  }

  decideApprovalRequest(id: string, decision: "approved" | "denied"): ApprovalRequest {
    const now = new Date().toISOString();
    const result = this.database.prepare(
      "UPDATE approval_requests SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'"
    ).run(decision, now, id);
    if (result.changes !== 1) throw new Error(`审批请求不存在或已处理：${id}`);
    return this.getApprovalRequest(id)!;
  }

  getApprovalRequest(id: string): ApprovalRequest | null {
    const row = this.database.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id) as ApprovalRequestRow | undefined;
    return row ? toApprovalRequest(row) : null;
  }

  listApprovals(harnessRunId: string): ApprovalRequest[] {
    return (this.database.prepare(
      "SELECT * FROM approval_requests WHERE harness_run_id = ? ORDER BY created_at"
    ).all(harnessRunId) as ApprovalRequestRow[]).map(toApprovalRequest);
  }

  createCheckpoint(input: {
    harnessRunId: string;
    kind: string;
    status: string;
    payload: Record<string, unknown>;
  }): HarnessCheckpoint {
    const checkpoint = harnessCheckpointSchema.parse({
      id: randomUUID(),
      harnessRunId: input.harnessRunId,
      kind: input.kind,
      status: input.status,
      payload: input.payload,
      createdAt: new Date().toISOString()
    });
    this.database.prepare(`INSERT INTO harness_checkpoints
      (id, harness_run_id, kind, status, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(checkpoint.id, checkpoint.harnessRunId, checkpoint.kind, checkpoint.status,
        JSON.stringify(checkpoint.payload), checkpoint.createdAt);
    return checkpoint;
  }

  getLatestCheckpoint(harnessRunId: string): HarnessCheckpoint | null {
    const row = this.database.prepare(
      "SELECT * FROM harness_checkpoints WHERE harness_run_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(harnessRunId) as HarnessCheckpointRow | undefined;
    return row ? toHarnessCheckpoint(row) : null;
  }

  listCheckpoints(harnessRunId: string): HarnessCheckpoint[] {
    return (this.database.prepare(
      "SELECT * FROM harness_checkpoints WHERE harness_run_id = ? ORDER BY created_at"
    ).all(harnessRunId) as HarnessCheckpointRow[]).map(toHarnessCheckpoint);
  }
}
