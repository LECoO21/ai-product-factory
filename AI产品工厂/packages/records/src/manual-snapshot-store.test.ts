import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SqliteProductManualIssuanceStore } from "./manual-issuance-store";
import {
  closeProductManualSnapshot,
  SqliteProductManualSnapshotStore
} from "./manual-snapshot-store";

const createDatabasePath = (): string =>
  join(mkdtempSync(join(tmpdir(), "factory-manual-snapshots-")), "manual-authority.sqlite");

const runChild = (source: string, args: string[] = []) => new Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}>((resolve, reject) => {
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    source,
    ...args
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve({ code, signal, stderr }));
});

describe("SqliteProductManualSnapshotStore", () => {
  it("durably records a body-free creating tombstone before reading the manuals", () => {
    const databasePath = createDatabasePath();
    const store = new SqliteProductManualSnapshotStore(databasePath);

    const result = store.loadOrCreate("product-reserved", () => {
      const observer = new Database(databasePath, { readonly: true });
      const row = observer.prepare(
        "SELECT state, snapshot_json, snapshot_sha256, error FROM product_manual_snapshots WHERE product_flow_id = ?"
      ).get("product-reserved");
      observer.close();
      expect(row).toEqual({
        state: "creating",
        snapshot_json: null,
        snapshot_sha256: null,
        error: null
      });
      return { context: "PRIVATE-MANUAL-CONTEXT" };
    });

    expect(result).toEqual({
      state: "active",
      snapshot: { context: "PRIVATE-MANUAL-CONTEXT" },
      error: null
    });
    store.close();
  });

  it("turns an interrupted creating tombstone into failure without rereading", async () => {
    const databasePath = createDatabasePath();
    const moduleUrl = pathToFileURL(join(import.meta.dirname, "manual-snapshot-store.ts")).href;
    const child = await runChild(`
      import { SqliteProductManualSnapshotStore } from ${JSON.stringify(moduleUrl)};
      const store = new SqliteProductManualSnapshotStore(process.argv[1]);
      store.loadOrCreate("product-crashed", () => {
        process.kill(process.pid, "SIGKILL");
      });
    `, [databasePath]);
    expect(child.signal).toBe("SIGKILL");

    let reread = false;
    const reopened = new SqliteProductManualSnapshotStore(databasePath);
    expect(reopened.loadOrCreate("product-crashed", () => {
      reread = true;
      return { context: "must-not-run" };
    })).toMatchObject({ state: "failed", snapshot: null });
    expect(reread).toBe(false);
    reopened.close();
  });

  it("allows concurrent processes to share one first read", async () => {
    const databasePath = createDatabasePath();
    const markerPath = join(mkdtempSync(join(tmpdir(), "factory-manual-read-marker-")), "reads.txt");
    const moduleUrl = pathToFileURL(join(import.meta.dirname, "manual-snapshot-store.ts")).href;
    const source = `
      import { appendFileSync } from "node:fs";
      import { SqliteProductManualSnapshotStore } from ${JSON.stringify(moduleUrl)};
      const store = new SqliteProductManualSnapshotStore(process.argv[1]);
      const result = store.loadOrCreate("product-concurrent", () => {
        appendFileSync(process.argv[2], "read\\n");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
        return { context: "one-snapshot" };
      });
      if (result.state !== "active") process.exitCode = 2;
      store.close();
    `;

    const results = await Promise.all([
      runChild(source, [databasePath, markerPath]),
      runChild(source, [databasePath, markerPath])
    ]);

    expect(results).toEqual([
      expect.objectContaining({ code: 0, signal: null, stderr: "" }),
      expect.objectContaining({ code: 0, signal: null, stderr: "" })
    ]);
    expect(readFileSync(markerPath, "utf8")).toBe("read\n");
  });

  it("creates the database privately even when the process umask permits world access", async () => {
    const databasePath = createDatabasePath();
    const moduleUrl = pathToFileURL(join(import.meta.dirname, "manual-snapshot-store.ts")).href;
    const databaseModuleUrl = pathToFileURL(
      join(import.meta.dirname, "../node_modules/better-sqlite3/lib/index.js")
    ).href;
    const child = await runChild(`
      import { statSync } from "node:fs";
      import Database from ${JSON.stringify(databaseModuleUrl)};
      import { SqliteProductManualSnapshotStore } from ${JSON.stringify(moduleUrl)};
      process.umask(0);
      const store = new SqliteProductManualSnapshotStore(process.argv[1]);
      store.loadOrCreate("product-private", () => ({ context: "private" }));
      const mode = statSync(process.argv[1]).mode & 0o777;
      const observer = new Database(process.argv[1]);
      observer.pragma("journal_mode = PERSIST");
      observer.exec("CREATE TABLE sidecar_probe (value TEXT NOT NULL)");
      observer.exec("BEGIN IMMEDIATE");
      observer.prepare("INSERT INTO sidecar_probe VALUES (?)").run("probe");
      const journalMode = statSync(process.argv[1] + "-journal").mode & 0o777;
      observer.exec("ROLLBACK");
      observer.close();
      store.close();
      if (mode !== 0o600 || journalMode !== 0o600) process.exitCode = 3;
    `, [databasePath]);

    expect(child).toEqual(expect.objectContaining({ code: 0, signal: null, stderr: "" }));
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
  });

  it("restores an active snapshot, then removes its text and keeps a closed tombstone", () => {
    const databasePath = createDatabasePath();
    const first = new SqliteProductManualSnapshotStore(databasePath);
    const snapshot = { stage: "v0.2-b", context: "PRIVATE-MANUAL-SENTINEL", records: [] };
    expect(first.loadOrCreate("product-a", () => snapshot)).toEqual({
      state: "active",
      snapshot,
      error: null
    });
    first.close();

    let unexpectedReads = 0;
    const reopened = new SqliteProductManualSnapshotStore(databasePath);
    expect(reopened.loadOrCreate("product-a", () => {
      unexpectedReads += 1;
      return { replacement: true };
    })).toEqual({ state: "active", snapshot, error: null });
    expect(unexpectedReads).toBe(0);
    expect(reopened.activeFlowIds()).toEqual(["product-a"]);
    reopened.release("product-a");
    reopened.close();

    const afterCompletion = new SqliteProductManualSnapshotStore(databasePath);
    expect(afterCompletion.loadOrCreate("product-a", () => {
      unexpectedReads += 1;
      return { replacement: true };
    })).toEqual({ state: "closed", snapshot: null, error: null });
    expect(afterCompletion.activeFlowIds()).toEqual([]);
    expect(unexpectedReads).toBe(0);
    afterCompletion.close();
    expect(readFileSync(databasePath).toString("utf8")).not.toContain("PRIVATE-MANUAL-SENTINEL");
  });

  it("closes both the private snapshot and the non-secret issued ledger", () => {
    const root = mkdtempSync(join(tmpdir(), "factory-manual-terminal-"));
    const manualDatabasePath = join(root, "private", "manual-authority.sqlite");
    const factoryDatabasePath = join(root, "data", "factory.sqlite");
    const issuance = new SqliteProductManualIssuanceStore(factoryDatabasePath);
    const claim = issuance.begin("product-terminal");
    if (!claim.owner) throw new Error("expected issuance owner");
    issuance.finish("product-terminal", claim.token);
    issuance.close();
    const snapshots = new SqliteProductManualSnapshotStore(manualDatabasePath);
    snapshots.loadOrCreate("product-terminal", () => ({ context: "TERMINAL-PRIVATE-TEXT" }));
    snapshots.close();

    closeProductManualSnapshot("product-terminal", manualDatabasePath, factoryDatabasePath);

    const restoredSnapshots = new SqliteProductManualSnapshotStore(manualDatabasePath);
    expect(restoredSnapshots.loadExisting("product-terminal")).toEqual({
      state: "closed",
      snapshot: null,
      error: null
    });
    restoredSnapshots.close();
    const restoredIssuance = new SqliteProductManualIssuanceStore(factoryDatabasePath);
    expect(restoredIssuance.begin("product-terminal")).toEqual({ owner: false, state: "closed" });
    restoredIssuance.close();
    expect(readFileSync(manualDatabasePath).toString("utf8")).not.toContain("TERMINAL-PRIVATE-TEXT");
  });

  it("stores a failed first read and never invokes the source callback again", () => {
    const databasePath = createDatabasePath();
    const first = new SqliteProductManualSnapshotStore(databasePath);
    expect(first.loadOrCreate("product-a", () => {
      throw new Error("original manuals invalid");
    })).toEqual({
      state: "failed",
      snapshot: null,
      error: "original manuals invalid"
    });
    first.close();

    let retried = false;
    const reopened = new SqliteProductManualSnapshotStore(databasePath);
    expect(reopened.loadOrCreate("product-a", () => {
      retried = true;
      return { replacement: true };
    })).toEqual({
      state: "failed",
      snapshot: null,
      error: "original manuals invalid"
    });
    expect(retried).toBe(false);
    reopened.close();
  });

  it("blocks a corrupt stored snapshot without falling back to source files", () => {
    const databasePath = createDatabasePath();
    const first = new SqliteProductManualSnapshotStore(databasePath);
    first.loadOrCreate("product-a", () => ({ context: "original" }));
    first.close();

    const database = new Database(databasePath);
    database.prepare(
      "UPDATE product_manual_snapshots SET snapshot_json = ? WHERE product_flow_id = ?"
    ).run('{"context":"corrupt"}', "product-a");
    database.close();

    let fallbackCalled = false;
    const reopened = new SqliteProductManualSnapshotStore(databasePath);
    expect(() => reopened.loadOrCreate("product-a", () => {
      fallbackCalled = true;
      return { context: "replacement" };
    })).toThrow(/持久化手册快照校验失败/);
    expect(fallbackCalled).toBe(false);
    expect(reopened.loadOrCreate("product-a", () => {
      fallbackCalled = true;
      return { context: "replacement" };
    })).toMatchObject({ state: "failed", snapshot: null });
    reopened.close();
    expect(readFileSync(databasePath).toString("utf8")).not.toContain("original");
  });

  it("erases a snapshot whose JSON is invalid even when its outer hash matches", () => {
    const databasePath = createDatabasePath();
    const first = new SqliteProductManualSnapshotStore(databasePath);
    first.loadOrCreate("product-json", () => ({ context: "PRIVATE-JSON-SENTINEL" }));
    first.close();

    const malformed = "{";
    const matchingHash = createHash("sha256").update(malformed).digest("hex");
    const database = new Database(databasePath);
    database.prepare(
      `UPDATE product_manual_snapshots
       SET snapshot_json = ?, snapshot_sha256 = ?
       WHERE product_flow_id = ?`
    ).run(malformed, matchingHash, "product-json");
    database.close();

    const reopened = new SqliteProductManualSnapshotStore(databasePath);
    expect(() => reopened.loadExisting("product-json")).toThrow(/格式损坏/);
    expect(reopened.loadExisting("product-json")).toMatchObject({
      state: "failed",
      snapshot: null
    });
    reopened.close();

    const verified = new Database(databasePath, { readonly: true });
    expect(verified.prepare(
      "SELECT state, snapshot_json, snapshot_sha256 FROM product_manual_snapshots WHERE product_flow_id = ?"
    ).get("product-json")).toEqual({
      state: "failed",
      snapshot_json: null,
      snapshot_sha256: null
    });
    verified.close();
    expect(readFileSync(databasePath).toString("utf8")).not.toContain("PRIVATE-JSON-SENTINEL");
  });
});
