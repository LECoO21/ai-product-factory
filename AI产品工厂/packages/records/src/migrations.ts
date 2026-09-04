import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

const minimumHarnessSql = `
  CREATE TABLE IF NOT EXISTS factory_tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    objective TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    max_attempts INTEGER NOT NULL,
    worker_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS factory_tasks_status_created
    ON factory_tasks(status, created_at);

  CREATE TABLE IF NOT EXISTS harness_runs (
    id TEXT PRIMARY KEY,
    production_run_id TEXT NOT NULL UNIQUE,
    task_id TEXT NOT NULL REFERENCES factory_tasks(id),
    session_path TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    stop_reason TEXT,
    tool_calls INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS work_plan_items (
    id TEXT PRIMARY KEY,
    harness_run_id TEXT NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(harness_run_id, position)
  );

  CREATE TABLE IF NOT EXISTS tool_invocations (
    id TEXT PRIMARY KEY,
    harness_run_id TEXT NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args_json TEXT NOT NULL,
    permission TEXT NOT NULL,
    status TEXT NOT NULL,
    result_json TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE(harness_run_id, tool_call_id)
  );

  CREATE TABLE IF NOT EXISTS background_jobs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES factory_tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    pid INTEGER,
    status TEXT NOT NULL,
    command_summary TEXT NOT NULL,
    exit_code INTEGER,
    stdout_path TEXT,
    stderr_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_tool_call_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
    criterion_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    artifact_id TEXT REFERENCES artifacts(id),
    observation_json TEXT NOT NULL,
    passed INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS evidence_run_criterion
    ON evidence(run_id, criterion_id);
`;

const codexAppServerRuntimeSql = `
  CREATE TABLE IF NOT EXISTS codex_account_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    authenticated INTEGER NOT NULL CHECK (authenticated IN (0, 1)),
    account_type TEXT CHECK (account_type IS NULL OR account_type = 'chatgpt'),
    email_hint TEXT,
    email_sha256 TEXT,
    plan_type TEXT,
    requires_openai_auth INTEGER NOT NULL CHECK (requires_openai_auth IN (0, 1)),
    captured_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS codex_capability_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    capabilities_json TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS codex_account_commands (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN (
      'account.login.start',
      'account.login.cancel',
      'account.logout',
      'account.refresh'
    )),
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    worker_id TEXT,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS codex_account_commands_status_created
    ON codex_account_commands(status, created_at, id);

  CREATE TABLE IF NOT EXISTS codex_thread_bindings (
    scope_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS codex_turn_bindings (
    run_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const productManualIssuanceSql = `
  CREATE TABLE IF NOT EXISTS product_manual_issuance (
    product_flow_id TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('issuing', 'issued', 'closed')),
    issuer_token TEXT,
    issuer_pid INTEGER,
    issued_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (state = 'issuing' AND issuer_token IS NOT NULL AND issuer_pid IS NOT NULL AND issuer_pid > 0)
      OR (state IN ('issued', 'closed') AND issuer_token IS NULL AND issuer_pid IS NULL)
    )
  );
`;

const codexThreadCleanupSql = `
  CREATE TABLE IF NOT EXISTS codex_thread_cleanup_jobs (
    id TEXT PRIMARY KEY,
    product_flow_id TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running')),
    worker_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(scope_id, thread_id)
  );
  CREATE INDEX IF NOT EXISTS codex_thread_cleanup_jobs_due
    ON codex_thread_cleanup_jobs(status, next_attempt_at, created_at, id);
  CREATE INDEX IF NOT EXISTS codex_thread_cleanup_jobs_product
    ON codex_thread_cleanup_jobs(product_flow_id, created_at, id);
`;

const harnessRoundsSql = `
  CREATE TABLE IF NOT EXISTS harness_rounds (
    id TEXT PRIMARY KEY,
    harness_run_id TEXT NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    decision TEXT NOT NULL,
    satisfied_json TEXT NOT NULL,
    missing_json TEXT NOT NULL,
    failed_json TEXT NOT NULL,
    next_action TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(harness_run_id, round)
  );
`;

const approvalRequestsSql = `
  CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY,
    harness_run_id TEXT NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args_json TEXT NOT NULL,
    args_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
    decided_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(harness_run_id, tool_call_id)
  );
  CREATE INDEX IF NOT EXISTS approval_requests_pending
    ON approval_requests(harness_run_id, status, created_at);
`;

const taskLeaseAndCheckpointsSql = `
  ALTER TABLE factory_tasks ADD COLUMN expires_at TEXT;
  CREATE TABLE IF NOT EXISTS harness_checkpoints (
    id TEXT PRIMARY KEY,
    harness_run_id TEXT NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS harness_checkpoints_run
    ON harness_checkpoints(harness_run_id, created_at);
`;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const migrations = [
  { version: 1, name: "0001-existing-baseline", sql: "-- existing schema baseline" },
  { version: 2, name: "0002-minimum-harness", sql: minimumHarnessSql },
  { version: 3, name: "0003-codex-app-server-runtime", sql: codexAppServerRuntimeSql },
  { version: 4, name: "0004-product-manual-issuance", sql: productManualIssuanceSql },
  { version: 5, name: "0005-codex-thread-cleanup", sql: codexThreadCleanupSql },
  { version: 6, name: "0006-harness-rounds", sql: harnessRoundsSql },
  { version: 7, name: "0007-approval-requests", sql: approvalRequestsSql },
  { version: 8, name: "0008-task-lease-and-checkpoints", sql: taskLeaseAndCheckpointsSql }
] as const;

export type MigrationReport = {
  applied: string[];
  backupPath: string | null;
};

export const migrateFactoryDatabase = (
  database: Database.Database,
  databasePath: string
): MigrationReport => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const applied: string[] = [];
  let backupPath: string | null = null;
  for (const migration of migrations) {
    const checksum = sha256(migration.sql);
    const existing = database
      .prepare("SELECT checksum FROM schema_migrations WHERE version = ?")
      .get(migration.version) as { checksum: string } | undefined;
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`迁移 checksum 不一致：${migration.name}`);
      }
      continue;
    }

    if (migration.version >= 2 && existsSync(databasePath)) {
      const backupDir = join(dirname(databasePath), "backups");
      mkdirSync(backupDir, { recursive: true });
      backupPath = join(
        backupDir,
        `before-${migration.name.slice(0, 4)}-${Date.now()}.sqlite`
      );
      database.prepare("VACUUM INTO ?").run(backupPath);
    }

    database.transaction(() => {
      if (migration.version !== 1) database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)"
        )
        .run(migration.version, migration.name, checksum, new Date().toISOString());
    })();
    applied.push(migration.name);
  }
  return { applied, backupPath };
};
