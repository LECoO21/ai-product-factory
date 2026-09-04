import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync
} from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { defaultDatabasePath } from "./database-path";
import { SqliteProductManualIssuanceStore } from "./manual-issuance-store";

export type StoredManualSnapshotState =
  | { state: "active"; snapshot: unknown; error: null }
  | { state: "closed"; snapshot: null; error: null }
  | { state: "failed"; snapshot: null; error: string };

type SnapshotRow = {
  product_flow_id: string;
  state: string;
  snapshot_json: string | null;
  snapshot_sha256: string | null;
  error: string | null;
  creator_token: string | null;
  creator_pid: number | null;
  created_at: string;
  updated_at: string;
};

type Reservation =
  | { owner: true; token: string }
  | { owner: false; row: SnapshotRow };

const creatingTimeoutMs = 60_000;
const creatingPollMs = 10;
const privateFileMode = 0o600;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const normalizeFlowId = (productFlowId: string): string => {
  const normalized = productFlowId.trim();
  if (!normalized) throw new Error("产品流程 ID 不能为空");
  return normalized;
};

const normalizeError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : "三份原始手册首次读取失败";
  return (raw.trim() || "三份原始手册首次读取失败").slice(0, 2_000);
};

const snapshotTableSql = `
  CREATE TABLE IF NOT EXISTS product_manual_snapshots (
    product_flow_id TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('creating', 'active', 'closed', 'failed')),
    snapshot_json TEXT,
    snapshot_sha256 TEXT,
    error TEXT,
    creator_token TEXT,
    creator_pid INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (state = 'creating' AND snapshot_json IS NULL AND snapshot_sha256 IS NULL AND error IS NULL
        AND creator_token IS NOT NULL AND creator_pid IS NOT NULL AND creator_pid > 0)
      OR (state = 'active' AND snapshot_json IS NOT NULL AND snapshot_sha256 IS NOT NULL AND error IS NULL
        AND creator_token IS NULL AND creator_pid IS NULL)
      OR (state = 'closed' AND snapshot_json IS NULL AND snapshot_sha256 IS NULL AND error IS NULL
        AND creator_token IS NULL AND creator_pid IS NULL)
      OR (state = 'failed' AND snapshot_json IS NULL AND snapshot_sha256 IS NULL AND error IS NOT NULL
        AND creator_token IS NULL AND creator_pid IS NULL)
    )
  )
`;

class StoredManualSnapshotIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoredManualSnapshotIntegrityError";
  }
}

const sleepSync = (milliseconds: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

const hardenExistingFile = (path: string) => {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`手册快照数据库路径不是普通文件：${path}`);
  }
  chmodSync(path, privateFileMode);
};

const preparePrivateDatabaseFile = (databasePath: string) => {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  try {
    const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
    const descriptor = openSync(
      databasePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollow,
      privateFileMode
    );
    closeSync(descriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    hardenExistingFile(databasePath);
  }
};

const hardenSqliteFiles = (databasePath: string) => {
  for (const path of [databasePath, `${databasePath}-journal`, `${databasePath}-wal`, `${databasePath}-shm`]) {
    hardenExistingFile(path);
  }
};

export const defaultManualSnapshotDatabasePath = (): string =>
  join(dirname(defaultDatabasePath()), "manual-authority.sqlite");

/**
 * Local-only persistence for protected manual snapshots.
 *
 * It deliberately uses a separate database from factory.sqlite so full manual
 * text is not included in the product database backup path.
 */
export class SqliteProductManualSnapshotStore {
  private readonly database: Database.Database;

  constructor(private readonly databasePath = defaultManualSnapshotDatabasePath()) {
    preparePrivateDatabaseFile(databasePath);
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = DELETE");
    this.database.pragma("secure_delete = ON");
    this.database.pragma("busy_timeout = 5000");
    this.ensureSchema();
    hardenSqliteFiles(databasePath);
  }

  loadOrCreate(
    productFlowId: string,
    createSnapshot: () => unknown
  ): StoredManualSnapshotState {
    const normalizedId = normalizeFlowId(productFlowId);
    try {
      const reservation = this.reserve(normalizedId);
      if (!reservation.owner) return this.resolveExisting(normalizedId, reservation.row);
      return this.createReserved(normalizedId, reservation.token, createSnapshot);
    } catch (error) {
      if (error instanceof StoredManualSnapshotIntegrityError) {
        try {
          this.fail(normalizedId, error.message);
        } catch {
          // Preserve the integrity error. A later open will fail closed again.
        }
      }
      throw error;
    } finally {
      hardenSqliteFiles(this.databasePath);
    }
  }

  loadExisting(productFlowId: string): StoredManualSnapshotState | null {
    const normalizedId = normalizeFlowId(productFlowId);
    try {
      const row = this.readRow(normalizedId);
      return row ? this.resolveExisting(normalizedId, row) : null;
    } catch (error) {
      if (error instanceof StoredManualSnapshotIntegrityError) {
        try {
          this.fail(normalizedId, error.message);
        } catch {
          // Preserve the integrity error. A later open will fail closed again.
        }
      }
      throw error;
    } finally {
      hardenSqliteFiles(this.databasePath);
    }
  }

  fail(productFlowId: string, error: unknown): void {
    const normalizedId = normalizeFlowId(productFlowId);
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO product_manual_snapshots (
        product_flow_id, state, snapshot_json, snapshot_sha256, error,
        creator_token, creator_pid, created_at, updated_at
      ) VALUES (?, 'failed', NULL, NULL, ?, NULL, NULL, ?, ?)
      ON CONFLICT(product_flow_id) DO UPDATE SET
        state = 'failed', snapshot_json = NULL, snapshot_sha256 = NULL,
        error = excluded.error, creator_token = NULL, creator_pid = NULL,
        updated_at = excluded.updated_at`
    ).run(normalizedId, normalizeError(error), now, now);
    hardenSqliteFiles(this.databasePath);
  }

  release(productFlowId: string): void {
    const normalizedId = normalizeFlowId(productFlowId);
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO product_manual_snapshots (
        product_flow_id, state, snapshot_json, snapshot_sha256, error,
        creator_token, creator_pid, created_at, updated_at
      ) VALUES (?, 'closed', NULL, NULL, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(product_flow_id) DO UPDATE SET
        state = 'closed', snapshot_json = NULL, snapshot_sha256 = NULL,
        error = NULL, creator_token = NULL, creator_pid = NULL,
        updated_at = excluded.updated_at`
    ).run(normalizedId, now, now);
    hardenSqliteFiles(this.databasePath);
  }

  activeFlowIds(): string[] {
    return (this.database.prepare(
      "SELECT product_flow_id FROM product_manual_snapshots WHERE state IN ('creating', 'active') ORDER BY created_at"
    ).all() as Array<{ product_flow_id: string }>).map((row) => row.product_flow_id);
  }

  close(): void {
    this.database.close();
    hardenSqliteFiles(this.databasePath);
  }

  private ensureSchema(): void {
    const existing = this.database.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'product_manual_snapshots'"
    ).get() as { sql: string | null } | undefined;
    if (!existing) {
      this.database.exec(snapshotTableSql);
      return;
    }

    const columns = this.database.prepare("PRAGMA table_info(product_manual_snapshots)").all() as Array<{
      name: string;
    }>;
    if (
      existing.sql?.includes("'creating'") &&
      columns.some((column) => column.name === "creator_token") &&
      columns.some((column) => column.name === "creator_pid")
    ) return;

    const legacyRows = this.database.prepare("SELECT * FROM product_manual_snapshots").all() as Array<{
      product_flow_id: string;
      state: string;
      snapshot_json: string | null;
      snapshot_sha256: string | null;
      error: string | null;
      created_at: string;
      updated_at: string;
    }>;
    const migrate = this.database.transaction(() => {
      this.database.exec("ALTER TABLE product_manual_snapshots RENAME TO product_manual_snapshots_legacy");
      this.database.exec(snapshotTableSql);
      const insert = this.database.prepare(
        `INSERT INTO product_manual_snapshots (
          product_flow_id, state, snapshot_json, snapshot_sha256, error,
          creator_token, creator_pid, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
      );
      for (const row of legacyRows) {
        const active = row.state === "active" && row.snapshot_json !== null &&
          row.snapshot_sha256 !== null && row.error === null;
        const closed = row.state === "closed" && row.snapshot_json === null &&
          row.snapshot_sha256 === null && row.error === null;
        const failed = row.state === "failed" && row.snapshot_json === null &&
          row.snapshot_sha256 === null && Boolean(row.error);
        if (active) {
          insert.run(row.product_flow_id, "active", row.snapshot_json, row.snapshot_sha256, null,
            row.created_at, row.updated_at);
        } else if (closed) {
          insert.run(row.product_flow_id, "closed", null, null, null, row.created_at, row.updated_at);
        } else {
          insert.run(row.product_flow_id, "failed", null, null,
            failed ? row.error : "旧版手册快照状态损坏，本产品流程已终止",
            row.created_at, row.updated_at);
        }
      }
      this.database.exec("DROP TABLE product_manual_snapshots_legacy");
    });
    migrate.immediate();
  }

  private reserve(productFlowId: string): Reservation {
    const token = randomUUID();
    const reserve = this.database.transaction(() => {
      const existing = this.readRow(productFlowId);
      if (existing) return { owner: false as const, row: existing };
      const now = new Date().toISOString();
      this.database.prepare(
        `INSERT INTO product_manual_snapshots (
          product_flow_id, state, snapshot_json, snapshot_sha256, error,
          creator_token, creator_pid, created_at, updated_at
        ) VALUES (?, 'creating', NULL, NULL, NULL, ?, ?, ?, ?)`
      ).run(productFlowId, token, process.pid, now, now);
      return { owner: true as const, token };
    });
    return reserve.immediate();
  }

  private createReserved(
    productFlowId: string,
    token: string,
    createSnapshot: () => unknown
  ): StoredManualSnapshotState {
    let snapshotJson: string | null = null;
    let creationError: string | null = null;
    try {
      const serialized = JSON.stringify(createSnapshot());
      if (typeof serialized !== "string") throw new Error("三份手册快照无法序列化");
      snapshotJson = serialized;
    } catch (error) {
      creationError = normalizeError(error);
    }

    const finish = this.database.transaction(() => {
      const now = new Date().toISOString();
      const update = snapshotJson === null
        ? this.database.prepare(
          `UPDATE product_manual_snapshots SET
            state = 'failed', snapshot_json = NULL, snapshot_sha256 = NULL, error = ?,
            creator_token = NULL, creator_pid = NULL, updated_at = ?
           WHERE product_flow_id = ? AND state = 'creating' AND creator_token = ?`
        ).run(creationError, now, productFlowId, token)
        : this.database.prepare(
          `UPDATE product_manual_snapshots SET
            state = 'active', snapshot_json = ?, snapshot_sha256 = ?, error = NULL,
            creator_token = NULL, creator_pid = NULL, updated_at = ?
           WHERE product_flow_id = ? AND state = 'creating' AND creator_token = ?`
        ).run(snapshotJson, sha256(snapshotJson), now, productFlowId, token);
      if (update.changes === 1) return this.readRequired(productFlowId);
      const current = this.readRow(productFlowId);
      if (!current) throw new Error(`手册快照状态不存在：${productFlowId}`);
      return this.resolveExisting(productFlowId, current);
    });
    return finish.immediate();
  }

  private resolveExisting(productFlowId: string, initialRow: SnapshotRow): StoredManualSnapshotState {
    let row = initialRow;
    while (row.state === "creating") {
      const createdAt = Date.parse(row.created_at);
      if (
        row.creator_pid === null || !Number.isSafeInteger(row.creator_pid) || row.creator_pid <= 0 ||
        row.creator_token === null || !row.creator_token || Number.isNaN(createdAt)
      ) throw new StoredManualSnapshotIntegrityError("创建中手册快照状态损坏");

      const expired = Date.now() - createdAt >= creatingTimeoutMs;
      const sameProcess = row.creator_pid === process.pid;
      if (sameProcess || expired || !processIsAlive(row.creator_pid)) {
        this.failCreating(
          productFlowId,
          "三份原始手册首次读取未完成，本产品流程已终止；请新建产品流程重试"
        );
        return this.readRequired(productFlowId);
      }
      sleepSync(creatingPollMs);
      const next = this.readRow(productFlowId);
      if (!next) throw new StoredManualSnapshotIntegrityError("创建中手册快照状态丢失");
      row = next;
    }
    return this.decodeRow(row);
  }

  private failCreating(productFlowId: string, error: string): void {
    const now = new Date().toISOString();
    this.database.prepare(
      `UPDATE product_manual_snapshots SET
        state = 'failed', snapshot_json = NULL, snapshot_sha256 = NULL, error = ?,
        creator_token = NULL, creator_pid = NULL, updated_at = ?
       WHERE product_flow_id = ? AND state = 'creating'`
    ).run(error, now, productFlowId);
  }

  private readRow(productFlowId: string): SnapshotRow | null {
    return (this.database.prepare(
      `SELECT product_flow_id, state, snapshot_json, snapshot_sha256, error,
              creator_token, creator_pid, created_at, updated_at
       FROM product_manual_snapshots WHERE product_flow_id = ?`
    ).get(productFlowId) as SnapshotRow | undefined) ?? null;
  }

  private decodeRow(row: SnapshotRow): StoredManualSnapshotState {
    if (row.state === "closed") {
      if (row.snapshot_json !== null || row.snapshot_sha256 !== null || row.error !== null ||
        row.creator_token !== null || row.creator_pid !== null) {
        throw new StoredManualSnapshotIntegrityError("已关闭手册快照状态损坏");
      }
      return { state: "closed", snapshot: null, error: null };
    }
    if (row.state === "failed") {
      if (row.snapshot_json !== null || row.snapshot_sha256 !== null ||
        typeof row.error !== "string" || !row.error ||
        row.creator_token !== null || row.creator_pid !== null) {
        throw new StoredManualSnapshotIntegrityError("失败手册快照状态损坏");
      }
      return { state: "failed", snapshot: null, error: row.error };
    }
    if (row.state === "creating") {
      throw new StoredManualSnapshotIntegrityError("创建中手册快照尚未恢复");
    }
    if (row.state !== "active") throw new StoredManualSnapshotIntegrityError("未知手册快照状态");
    if (row.snapshot_json === null || row.snapshot_sha256 === null || row.error !== null ||
      row.creator_token !== null || row.creator_pid !== null) {
      throw new StoredManualSnapshotIntegrityError("活动手册快照状态损坏");
    }
    if (sha256(row.snapshot_json) !== row.snapshot_sha256) {
      throw new StoredManualSnapshotIntegrityError("持久化手册快照校验失败");
    }
    try {
      return { state: "active", snapshot: JSON.parse(row.snapshot_json) as unknown, error: null };
    } catch {
      throw new StoredManualSnapshotIntegrityError("持久化手册快照格式损坏");
    }
  }

  private readRequired(productFlowId: string): StoredManualSnapshotState {
    const row = this.readRow(productFlowId);
    if (!row) throw new Error(`手册快照状态不存在：${productFlowId}`);
    return this.decodeRow(row);
  }
}

/** Immediately removes a product flow's protected manual body while retaining
 * its non-reopenable tombstone. Intended for terminal HTTP actions that may
 * happen while the Worker is stopped. */
export const closeProductManualSnapshot = (
  productFlowId: string,
  databasePath = defaultManualSnapshotDatabasePath(),
  factoryDatabasePath = defaultDatabasePath()
): void => {
  const store = new SqliteProductManualSnapshotStore(databasePath);
  try {
    store.release(productFlowId);
  } finally {
    store.close();
  }
  const issuance = new SqliteProductManualIssuanceStore(factoryDatabasePath);
  try {
    issuance.markClosed(productFlowId);
  } finally {
    issuance.close();
  }
};
