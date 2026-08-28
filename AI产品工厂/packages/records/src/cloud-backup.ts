import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import Database from "better-sqlite3";
import { defaultDatabasePath } from "./database-path";

export interface ObjectStore {
  get(key: string): Promise<Buffer | null>;
  put(key: string, content: Buffer, contentType: string): Promise<void>;
}

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>();

  async get(key: string) {
    const value = this.objects.get(key);
    return value ? Buffer.from(value) : null;
  }

  async put(key: string, content: Buffer) {
    this.objects.set(key, Buffer.from(content));
  }
}

class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    endpoint: string,
    region: string,
    accessKeyId: string,
    secretAccessKey: string
  ) {
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: false,
      credentials: { accessKeyId, secretAccessKey }
    });
  }

  async get(key: string) {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body) return null;
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (["NoSuchKey", "NotFound", "NoSuchBucket"].includes(name)) return null;
      throw error;
    }
  }

  async put(key: string, content: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: content,
      ContentType: contentType,
      ServerSideEncryption: "AES256"
    }));
  }
}

const configuredPrefix = () =>
  (process.env.S3_PREFIX?.trim() || "ai-product-factory").replace(/^\/+|\/+$/g, "");

export const databaseBackupKey = () => `${configuredPrefix()}/database/factory.sqlite`;

export const artifactBackupKey = (sha256: string, path: string) =>
  `${configuredPrefix()}/artifacts/${sha256}/${basename(path).replace(/[^a-zA-Z0-9._-]/g, "_")}`;

export const createConfiguredObjectStore = (): ObjectStore | null => {
  if ((process.env.STORAGE_PROVIDER?.trim() || "local") !== "s3") return null;
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const region = process.env.S3_REGION?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.S3_SECRET_KEY?.trim();
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 对象存储配置不完整");
  }
  return new S3ObjectStore(bucket, endpoint, region, accessKeyId, secretAccessKey);
};

const verifyDatabase = (path: string) => {
  const database = new Database(path, { readonly: true });
  try {
    const result = database.pragma("integrity_check", { simple: true });
    if (result !== "ok") throw new Error("SQLite 备份完整性检查失败");
  } finally {
    database.close();
  }
};

export type BackupResult = {
  status: "completed" | "skipped";
  databaseKey?: string;
  artifactCount?: number;
  sha256?: string;
  reason?: string;
};

export async function restoreFactoryDatabaseIfMissing(options: {
  databasePath?: string;
  store?: ObjectStore | null;
} = {}): Promise<BackupResult> {
  const databasePath = options.databasePath ?? defaultDatabasePath();
  if (existsSync(databasePath)) return { status: "skipped", reason: "local_database_exists" };
  const store = options.store === undefined ? createConfiguredObjectStore() : options.store;
  if (!store) return { status: "skipped", reason: "cloud_storage_disabled" };
  const key = databaseBackupKey();
  const content = await store.get(key);
  if (!content) return { status: "skipped", reason: "cloud_backup_missing" };
  mkdirSync(dirname(databasePath), { recursive: true });
  const temporaryPath = `${databasePath}.restore-${process.pid}`;
  writeFileSync(temporaryPath, content, { mode: 0o600 });
  try {
    verifyDatabase(temporaryPath);
    renameSync(temporaryPath, databasePath);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
  return {
    status: "completed",
    databaseKey: key,
    sha256: createHash("sha256").update(content).digest("hex"),
    artifactCount: 0
  };
}

export async function backupFactoryData(options: {
  databasePath?: string;
  store?: ObjectStore | null;
} = {}): Promise<BackupResult> {
  const databasePath = options.databasePath ?? defaultDatabasePath();
  if (!existsSync(databasePath)) return { status: "skipped", reason: "local_database_missing" };
  const store = options.store === undefined ? createConfiguredObjectStore() : options.store;
  if (!store) return { status: "skipped", reason: "cloud_storage_disabled" };

  const backupDirectory = join(dirname(databasePath), "backups");
  mkdirSync(backupDirectory, { recursive: true });
  const snapshotPath = join(backupDirectory, `cloud-${Date.now()}-${process.pid}.sqlite`);
  const database = new Database(databasePath);
  try {
    database.pragma("wal_checkpoint(PASSIVE)");
    await database.backup(snapshotPath);
  } finally {
    database.close();
  }

  try {
    verifyDatabase(snapshotPath);
    const content = readFileSync(snapshotPath);
    const key = databaseBackupKey();
    await store.put(key, content, "application/vnd.sqlite3");

    const snapshot = new Database(snapshotPath, { readonly: true });
    let artifacts: Array<{ path: string; sha256: string; mime_type: string }> = [];
    try {
      const table = snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='artifacts'").get();
      if (table) {
        artifacts = snapshot.prepare(
          "SELECT path, sha256, mime_type FROM artifacts WHERE status = 'ready' ORDER BY created_at"
        ).all() as Array<{ path: string; sha256: string; mime_type: string }>;
      }
    } finally {
      snapshot.close();
    }

    let artifactCount = 0;
    for (const artifact of artifacts) {
      if (!existsSync(artifact.path)) continue;
      await store.put(
        artifactBackupKey(artifact.sha256, artifact.path),
        readFileSync(artifact.path),
        artifact.mime_type
      );
      artifactCount += 1;
    }
    return {
      status: "completed",
      databaseKey: key,
      artifactCount,
      sha256: createHash("sha256").update(content).digest("hex")
    };
  } finally {
    if (existsSync(snapshotPath)) unlinkSync(snapshotPath);
  }
}

export async function readArtifactContent(artifact: { path: string; sha256: string }) {
  if (existsSync(artifact.path)) return readFileSync(artifact.path);
  const store = createConfiguredObjectStore();
  if (!store) throw new Error("产物文件不存在且云存储未启用");
  const content = await store.get(artifactBackupKey(artifact.sha256, artifact.path));
  if (!content) throw new Error("云端产物不存在");
  if (createHash("sha256").update(content).digest("hex") !== artifact.sha256) {
    throw new Error("云端产物完整性校验失败");
  }
  mkdirSync(dirname(artifact.path), { recursive: true });
  writeFileSync(artifact.path, content, { mode: 0o600 });
  return content;
}

export function startFactoryBackupScheduler(options: {
  intervalMs?: number;
  databasePath?: string;
  store?: ObjectStore | null;
  onResult?: (result: BackupResult) => void;
  onError?: (error: unknown) => void;
} = {}) {
  const intervalMs = Math.max(options.intervalMs ?? Number(process.env.BACKUP_INTERVAL_MS || 300_000), 60_000);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      options.onResult?.(await backupFactoryData(options));
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), Math.min(intervalMs, 10_000));
  const timer = setInterval(() => void run(), intervalMs);
  first.unref();
  timer.unref();
  return {
    run,
    stop: () => {
      clearTimeout(first);
      clearInterval(timer);
    }
  };
}
