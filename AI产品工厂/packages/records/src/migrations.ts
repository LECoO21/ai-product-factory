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

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const migrations = [
  { version: 1, name: "0001-existing-baseline", sql: "-- existing schema baseline" },
  { version: 2, name: "0002-minimum-harness", sql: minimumHarnessSql }
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

    if (migration.version === 2 && existsSync(databasePath)) {
      const backupDir = join(dirname(databasePath), "backups");
      mkdirSync(backupDir, { recursive: true });
      backupPath = join(backupDir, `before-0002-${Date.now()}.sqlite`);
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
