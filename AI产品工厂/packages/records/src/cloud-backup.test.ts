import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  backupFactoryData,
  databaseBackupKey,
  MemoryObjectStore,
  restoreFactoryDatabaseIfMissing
} from "./cloud-backup";

describe("factory cloud backup", () => {
  it("creates an intact snapshot and restores only when the local database is missing", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-cloud-backup-"));
    const databasePath = join(directory, "factory.sqlite");
    const database = new Database(databasePath);
    database.exec("CREATE TABLE facts (value TEXT NOT NULL); INSERT INTO facts VALUES ('kept')");
    database.close();
    const store = new MemoryObjectStore();

    const backup = await backupFactoryData({ databasePath, store });
    expect(backup.status).toBe("completed");
    expect(store.objects.has(databaseBackupKey())).toBe(true);

    expect((await restoreFactoryDatabaseIfMissing({ databasePath, store })).reason).toBe("local_database_exists");
    unlinkSync(databasePath);
    expect(existsSync(databasePath)).toBe(false);
    expect((await restoreFactoryDatabaseIfMissing({ databasePath, store })).status).toBe("completed");

    const restored = new Database(databasePath, { readonly: true });
    expect(restored.prepare("SELECT value FROM facts").pluck().get()).toBe("kept");
    restored.close();
  });
});
