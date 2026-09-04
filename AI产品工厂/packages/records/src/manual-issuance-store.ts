import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { defaultDatabasePath } from "./database-path";
import { migrateFactoryDatabase } from "./migrations";

export type ProductManualIssuanceClaim =
  | { owner: true; token: string }
  | { owner: false; state: "issued" | "closed" };

type IssuanceRow = {
  product_flow_id: string;
  state: "issuing" | "issued" | "closed";
  issuer_token: string | null;
  issuer_pid: number | null;
  issued_at: string;
  updated_at: string;
};

const issuingTimeoutMs = 60_000;
const issuingPollMs = 10;

const normalizeFlowId = (productFlowId: string): string => {
  const normalized = productFlowId.trim();
  if (!normalized) throw new Error("产品流程 ID 不能为空");
  return normalized;
};

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

/**
 * Non-secret ledger in factory.sqlite proving that a product flow has already
 * been issued its one permitted protected-manual snapshot.
 */
export class SqliteProductManualIssuanceStore {
  private readonly database: Database.Database;

  constructor(databasePath = defaultDatabasePath()) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    migrateFactoryDatabase(this.database, databasePath);
  }

  begin(productFlowId: string): ProductManualIssuanceClaim {
    const normalizedId = normalizeFlowId(productFlowId);
    const token = randomUUID();
    const claim = this.database.transaction(() => {
      const existing = this.read(normalizedId);
      if (existing) return { owner: false as const, row: existing };
      const now = new Date().toISOString();
      this.database.prepare(
        `INSERT INTO product_manual_issuance (
          product_flow_id, state, issuer_token, issuer_pid, issued_at, updated_at
        ) VALUES (?, 'issuing', ?, ?, ?, ?)`
      ).run(normalizedId, token, process.pid, now, now);
      return { owner: true as const, token };
    }).immediate();
    if (claim.owner) return claim;

    let row = claim.row;
    while (row.state === "issuing") {
      const issuedAt = Date.parse(row.issued_at);
      const invalid = row.issuer_pid === null || !Number.isSafeInteger(row.issuer_pid) ||
        row.issuer_pid <= 0 || !row.issuer_token || Number.isNaN(issuedAt);
      const expired = !Number.isNaN(issuedAt) && Date.now() - issuedAt >= issuingTimeoutMs;
      if (invalid || row.issuer_pid === process.pid || expired || !processIsAlive(row.issuer_pid!)) {
        this.recoverIssuing(normalizedId, row.issuer_token);
      } else {
        sleepSync(issuingPollMs);
      }
      const next = this.read(normalizedId);
      if (!next) throw new Error(`手册快照签发标记丢失：${normalizedId}`);
      row = next;
    }
    return { owner: false, state: row.state };
  }

  finish(productFlowId: string, token: string): void {
    const normalizedId = normalizeFlowId(productFlowId);
    if (!token.trim()) throw new Error("手册快照签发 token 不能为空");
    const finish = this.database.transaction(() => {
      const existing = this.read(normalizedId);
      if (!existing) throw new Error(`手册快照签发标记不存在：${normalizedId}`);
      if (existing.state === "issued" || existing.state === "closed") return;
      if (existing.issuer_token !== token) throw new Error("手册快照签发所有权冲突");
      const result = this.database.prepare(
        `UPDATE product_manual_issuance SET
          state = 'issued', issuer_token = NULL, issuer_pid = NULL, updated_at = ?
         WHERE product_flow_id = ? AND state = 'issuing' AND issuer_token = ?`
      ).run(new Date().toISOString(), normalizedId, token);
      if (result.changes !== 1) throw new Error("手册快照签发状态冲突");
    });
    finish.immediate();
  }

  markClosed(productFlowId: string): void {
    const normalizedId = normalizeFlowId(productFlowId);
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO product_manual_issuance (
        product_flow_id, state, issuer_token, issuer_pid, issued_at, updated_at
      ) VALUES (?, 'closed', NULL, NULL, ?, ?)
      ON CONFLICT(product_flow_id) DO UPDATE SET
        state = 'closed', issuer_token = NULL, issuer_pid = NULL,
        updated_at = excluded.updated_at`
    ).run(normalizedId, now, now);
  }

  close(): void {
    this.database.close();
  }

  private recoverIssuing(productFlowId: string, token: string | null): void {
    this.database.prepare(
      `UPDATE product_manual_issuance SET
        state = 'issued', issuer_token = NULL, issuer_pid = NULL, updated_at = ?
       WHERE product_flow_id = ? AND state = 'issuing'
         AND ((issuer_token = ?) OR (issuer_token IS NULL AND ? IS NULL))`
    ).run(new Date().toISOString(), productFlowId, token, token);
  }

  private read(productFlowId: string): IssuanceRow | null {
    return (this.database.prepare(
      `SELECT product_flow_id, state, issuer_token, issuer_pid, issued_at, updated_at
       FROM product_manual_issuance WHERE product_flow_id = ?`
    ).get(productFlowId) as IssuanceRow | undefined) ?? null;
  }
}

export const markProductManualIssuanceClosed = (
  productFlowId: string,
  databasePath = defaultDatabasePath()
): void => {
  const store = new SqliteProductManualIssuanceStore(databasePath);
  try {
    store.markClosed(productFlowId);
  } finally {
    store.close();
  }
};
