import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  productProjectSchema,
  productionEventSchema,
  productionRunSchema,
  runEventSchema,
  type ProductProject,
  type ProductionEvent,
  type ProductionRun,
  type ProductionStage,
  type RunEvent,
  type ProjectSummary
} from "@factory/shared";
import { defaultDatabasePath } from "./database-path";

export { defaultDatabasePath, findFactoryRoot } from "./database-path";

export interface ProjectRegistry {
  save(project: ProductProject, event: ProductionEvent): void;
  get(id: string): ProductProject | null;
  list(): ProjectSummary[];
  events(projectId: string): ProductionEvent[];
}

export interface ProductionRunStore {
  create(projectId: string, objective: string, stage?: ProductionStage): ProductionRun;
  get(id: string): ProductionRun | null;
  listForProject(projectId: string): ProductionRun[];
  claimNext(workerId: string): ProductionRun | null;
  append(runId: string, type: string, payload?: Record<string, unknown>): RunEvent;
  events(runId: string, afterSequence?: number): RunEvent[];
  transition(id: string, status: ProductionRun["status"], error?: string | null): ProductionRun;
  approveAndCreateNext(
    id: string,
    nextObjective: string,
    nextStage: ProductionStage
  ): { completedRun: ProductionRun; nextRun: ProductionRun };
  approveAndComplete(id: string, gate?: string): { completedRun: ProductionRun; nextRun: null };
}

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  prd: string;
  workspace_path: string | null;
  status: ProductProject["status"];
  profile_json: string;
  blueprint_json: string;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  project_id: string;
  type: string;
  payload_json: string;
  occurred_at: string;
};

type RunRow = {
  id: string;
  project_id: string;
  stage: ProductionStage;
  objective: string;
  status: ProductionRun["status"];
  worker_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type RunEventRow = {
  sequence: number;
  id: string;
  run_id: string;
  type: string;
  payload_json: string;
  occurred_at: string;
};

const toProject = (row: ProjectRow): ProductProject =>
  productProjectSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    prd: row.prd,
    workspacePath: row.workspace_path,
    status: row.status,
    profile: JSON.parse(row.profile_json),
    blueprint: JSON.parse(row.blueprint_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

const toEvent = (row: EventRow): ProductionEvent =>
  productionEventSchema.parse({
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    payload: JSON.parse(row.payload_json),
    occurredAt: row.occurred_at
  });

export class SqliteProjectRegistry implements ProjectRegistry {
  private readonly database: Database.Database;

  constructor(databasePath = defaultDatabasePath()) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    SqliteProjectRegistry.migrate(this.database);
  }

  static migrate(database: Database.Database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        prd TEXT NOT NULL,
        workspace_path TEXT,
        status TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        blueprint_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS production_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS production_events_project_time
        ON production_events(project_id, occurred_at);

      CREATE TABLE IF NOT EXISTS production_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        stage TEXT NOT NULL DEFAULT 'intake',
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        worker_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS run_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS production_runs_project_time
        ON production_runs(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS run_events_run_sequence
        ON run_events(run_id, sequence);
    `);

    const runColumns = database.prepare("PRAGMA table_info(production_runs)").all() as Array<{
      name: string;
    }>;
    if (!runColumns.some((column) => column.name === "stage")) {
      database.exec("ALTER TABLE production_runs ADD COLUMN stage TEXT NOT NULL DEFAULT 'intake'");
    }
  }

  save(project: ProductProject, event: ProductionEvent) {
    const validatedProject = productProjectSchema.parse(project);
    const validatedEvent = productionEventSchema.parse(event);
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO projects (
            id, name, description, prd, workspace_path, status,
            profile_json, blueprint_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            prd = excluded.prd,
            workspace_path = excluded.workspace_path,
            status = excluded.status,
            profile_json = excluded.profile_json,
            blueprint_json = excluded.blueprint_json,
            updated_at = excluded.updated_at`
        )
        .run(
          validatedProject.id,
          validatedProject.name,
          validatedProject.description,
          validatedProject.prd,
          validatedProject.workspacePath,
          validatedProject.status,
          JSON.stringify(validatedProject.profile),
          JSON.stringify(validatedProject.blueprint),
          validatedProject.createdAt,
          validatedProject.updatedAt
        );

      this.database
        .prepare(
          `INSERT OR IGNORE INTO production_events
            (id, project_id, type, payload_json, occurred_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          validatedEvent.id,
          validatedEvent.projectId,
          validatedEvent.type,
          JSON.stringify(validatedEvent.payload),
          validatedEvent.occurredAt
        );
    });
    transaction();
  }

  get(id: string): ProductProject | null {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | ProjectRow
      | undefined;
    return row ? toProject(row) : null;
  }

  list(): ProjectSummary[] {
    const rows = this.database
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as ProjectRow[];
    return rows.map((row) => {
      const project = toProject(row);
      const { prd: _prd, workspacePath: _workspacePath, ...summary } = project;
      void _prd;
      void _workspacePath;
      return summary;
    });
  }

  events(projectId: string): ProductionEvent[] {
    const rows = this.database
      .prepare(
        "SELECT id, project_id, type, payload_json, occurred_at FROM production_events WHERE project_id = ? ORDER BY occurred_at ASC"
      )
      .all(projectId) as EventRow[];
    return rows.map(toEvent);
  }
}

export { migrateFactoryDatabase, type MigrationReport } from "./migrations";
export { SqliteHarnessRecordStore } from "./harness-records";
export {
  artifactBackupKey,
  backupFactoryData,
  createConfiguredObjectStore,
  databaseBackupKey,
  MemoryObjectStore,
  readArtifactContent,
  restoreFactoryDatabaseIfMissing,
  startFactoryBackupScheduler,
  type BackupResult,
  type ObjectStore
} from "./cloud-backup";

const toRun = (row: RunRow): ProductionRun =>
  productionRunSchema.parse({
    id: row.id,
    projectId: row.project_id,
    stage: row.stage,
    objective: row.objective,
    status: row.status,
    workerId: row.worker_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

const toRunEvent = (row: RunEventRow): RunEvent =>
  runEventSchema.parse({
    sequence: row.sequence,
    id: row.id,
    runId: row.run_id,
    type: row.type,
    payload: JSON.parse(row.payload_json),
    occurredAt: row.occurred_at
  });

export class SqliteProductionRunStore implements ProductionRunStore {
  private readonly database: Database.Database;

  constructor(databasePath = defaultDatabasePath()) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    SqliteProjectRegistry.migrate(this.database);
  }

  create(projectId: string, objective: string, stage: ProductionStage = "intake"): ProductionRun {
    const now = new Date().toISOString();
    const run = productionRunSchema.parse({
      id: randomUUID(),
      projectId,
      stage,
      objective,
      status: "ready",
      workerId: null,
      error: null,
      createdAt: now,
      updatedAt: now
    });
    this.database
      .prepare(
        `INSERT INTO production_runs
          (id, project_id, stage, objective, status, worker_id, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(run.id, run.projectId, run.stage, run.objective, run.status, null, null, now, now);
    this.append(run.id, "run.created", { objective, stage });
    return run;
  }

  get(id: string): ProductionRun | null {
    const row = this.database.prepare("SELECT * FROM production_runs WHERE id = ?").get(id) as
      | RunRow
      | undefined;
    return row ? toRun(row) : null;
  }

  listForProject(projectId: string): ProductionRun[] {
    const rows = this.database
      .prepare("SELECT * FROM production_runs WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as RunRow[];
    return rows.map(toRun);
  }

  claimNext(workerId: string): ProductionRun | null {
    const claim = this.database.transaction(() => {
      const row = this.database
        .prepare("SELECT * FROM production_runs WHERE status = 'ready' ORDER BY created_at ASC LIMIT 1")
        .get() as RunRow | undefined;
      if (!row) return null;
      const now = new Date().toISOString();
      const result = this.database
        .prepare(
          "UPDATE production_runs SET status = 'running', worker_id = ?, updated_at = ? WHERE id = ? AND status = 'ready'"
        )
        .run(workerId, now, row.id);
      if (result.changes !== 1) return null;
      return this.get(row.id);
    });
    const run = claim();
    if (run) this.append(run.id, "run.claimed", { workerId });
    return run;
  }

  append(runId: string, type: string, payload: Record<string, unknown> = {}): RunEvent {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const result = this.database
      .prepare(
        "INSERT INTO run_events (id, run_id, type, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(eventId, runId, type, JSON.stringify(payload), occurredAt);
    return runEventSchema.parse({
      sequence: Number(result.lastInsertRowid),
      id: eventId,
      runId,
      type,
      payload,
      occurredAt
    });
  }

  events(runId: string, afterSequence = 0): RunEvent[] {
    const rows = this.database
      .prepare("SELECT * FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC")
      .all(runId, afterSequence) as RunEventRow[];
    return rows.map(toRunEvent);
  }

  transition(id: string, status: ProductionRun["status"], error: string | null = null) {
    const now = new Date().toISOString();
    const result = this.database
      .prepare("UPDATE production_runs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(status, error, now, id);
    if (result.changes !== 1) throw new Error(`生产批次不存在：${id}`);
    this.append(id, `run.${status}`, error ? { error } : {});
    const run = this.get(id);
    if (!run) throw new Error(`生产批次无法重新读取：${id}`);
    return run;
  }

  approveAndCreateNext(id: string, nextObjective: string, nextStage: ProductionStage) {
    return this.database.transaction(() => {
      const run = this.get(id);
      if (!run) throw new Error(`生产批次不存在：${id}`);
      const approved = this.events(id).find((event) => event.type === "gate.approved");
      const approvedNextRunId = approved?.payload.nextRunId;
      if (typeof approvedNextRunId === "string") {
        const existingNextRun = this.get(approvedNextRunId);
        if (existingNextRun) return { completedRun: run, nextRun: existingNextRun };
      }
      if (run.status !== "waiting_approval" && run.status !== "succeeded") {
        throw new Error("当前步骤尚未等待确认");
      }

      const completedRun =
        run.status === "succeeded" ? run : this.transition(run.id, "succeeded");
      const nextRun = this.create(run.projectId, nextObjective, nextStage);
      this.append(run.id, "gate.approved", {
        gate: "product_scope",
        nextRunId: nextRun.id,
        nextStage
      });
      return { completedRun, nextRun };
    })();
  }

  approveAndComplete(id: string, gate = "manual_completion") {
    return this.database.transaction(() => {
      const run = this.get(id);
      if (!run) throw new Error(`生产批次不存在：${id}`);
      const approved = this.events(id).find((event) => event.type === "gate.approved");
      if (approved?.payload.completed === true) {
        return { completedRun: run, nextRun: null };
      }
      if (run.status !== "waiting_approval" && run.status !== "succeeded") {
        throw new Error("当前步骤尚未等待确认");
      }
      const completedRun =
        run.status === "succeeded" ? run : this.transition(run.id, "succeeded");
      if (gate === "release_handoff") {
        this.database
          .prepare("UPDATE projects SET status = 'candidate', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), run.projectId);
      }
      this.append(run.id, "gate.approved", {
        gate,
        completed: true,
        deploymentStarted: false,
        ...(gate === "release_handoff" ? { projectStatus: "candidate" } : {})
      });
      return { completedRun, nextRun: null };
    })();
  }
}
