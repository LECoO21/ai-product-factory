import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const manualNames = [
  "AI产品Vibe Coding通用技术栈手册.md",
  "AI产品Vibe Coding通用前端技术栈手册.md",
  "AI Agent 产品上线部署手册.md"
] as const;
const manualSeparator = "\n\n--- 下一份原始手册 ---\n\n";

export type ManualLoadRecord = {
  path: string;
  sha256: string;
  characters: number;
  ok: true;
};

export type ProtectedManualContext = {
  stage: "v0.2-b";
  records: readonly ManualLoadRecord[];
  context: string;
};

export type ProductManualContext = {
  readonly productFlowId: string;
  readonly authority: ManualAuthority;
  readonly snapshot: ProtectedManualContext;
};

export type StoredProductManualSnapshot =
  | { state: "active"; snapshot: unknown; error: null }
  | { state: "closed"; snapshot: null; error: null }
  | { state: "failed"; snapshot: null; error: string };

/** Local/private persistence boundary. Implementations must never fall back to
 * createSnapshot when a row already exists, including corrupt or failed rows. */
export interface ProductManualSnapshotStore {
  loadOrCreate(
    productFlowId: string,
    createSnapshot: () => unknown
  ): StoredProductManualSnapshot;
  loadExisting(productFlowId: string): StoredProductManualSnapshot | null;
  fail(productFlowId: string, error: string): void;
  release(productFlowId: string): void;
  activeFlowIds(): string[];
}

export type ProductManualIssuanceClaim =
  | { owner: true; token: string }
  | { owner: false; state: "issued" | "closed" };

/** Non-secret factory database boundary proving a flow has already received
 * its one permitted protected-manual snapshot. */
export interface ProductManualIssuanceStore {
  begin(productFlowId: string): ProductManualIssuanceClaim;
  finish(productFlowId: string, token: string): void;
  markClosed(productFlowId: string): void;
}

const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "三份原始手册首次读取失败";

const restoreSnapshot = (value: unknown): ProtectedManualContext => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("持久快照不是对象");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.stage !== "v0.2-b") throw new Error("持久快照阶段无效");
  if (typeof candidate.context !== "string") throw new Error("持久快照正文无效");
  const context = candidate.context;
  if (!Array.isArray(candidate.records) || candidate.records.length !== manualNames.length) {
    throw new Error("持久快照手册数量无效");
  }

  const records = candidate.records.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("持久快照记录无效");
    }
    const record = value as Record<string, unknown>;
    const expectedName = manualNames[index];
    if (
      typeof record.path !== "string" ||
      basename(record.path) !== expectedName ||
      typeof record.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.sha256) ||
      typeof record.characters !== "number" ||
      !Number.isSafeInteger(record.characters) ||
      record.characters < 0 ||
      record.ok !== true
    ) {
      throw new Error(`持久快照记录无效：${expectedName}`);
    }
    return Object.freeze({
      path: record.path,
      sha256: record.sha256,
      characters: record.characters,
      ok: true as const
    });
  });

  let offset = 0;
  records.forEach((record, index) => {
    const content = context.slice(offset, offset + record.characters);
    if (content.length !== record.characters || sha256(content) !== record.sha256) {
      throw new Error(`持久快照正文校验失败：${manualNames[index]}`);
    }
    offset += record.characters;
    if (index < records.length - 1) {
      if (context.slice(offset, offset + manualSeparator.length) !== manualSeparator) {
        throw new Error("持久快照分隔符无效");
      }
      offset += manualSeparator.length;
    }
  });
  if (offset !== context.length) throw new Error("持久快照正文长度无效");

  return Object.freeze({
    stage: "v0.2-b",
    records: Object.freeze(records),
    context
  });
};

export class ManualAuthority {
  private snapshot: ProtectedManualContext | null = null;

  constructor(
    private readonly projectRoot: string,
    initialSnapshot?: ProtectedManualContext
  ) {
    if (initialSnapshot) this.snapshot = restoreSnapshot(initialSnapshot);
  }

  verify(): readonly ManualLoadRecord[] {
    this.snapshot ??= this.readSnapshot();
    return this.snapshot.records;
  }

  private readSnapshot(): ProtectedManualContext {
    const configuredRoot = process.env.FACTORY_MANUALS_DIR?.trim();
    const authorityRoot = configuredRoot ? resolve(configuredRoot) : dirname(resolve(this.projectRoot));
    const checksumFile = configuredRoot
      ? join(authorityRoot, "MANUALS.sha256")
      : join(this.projectRoot, "docs", "MANUALS.sha256");
    if (!existsSync(/* turbopackIgnore: true */ checksumFile)) throw new Error("三份手册校验文件缺失");
    const expected = new Map(
      readFileSync(/* turbopackIgnore: true */ checksumFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
          if (!match?.[1] || !match[2]) throw new Error("三份手册校验文件格式错误");
          return [basename(match[2]), match[1]] as const;
        })
    );
    const contents = new Map<string, string>();
    const records = manualNames.map((name) => {
      const path = join(/* turbopackIgnore: true */ authorityRoot, name);
      if (!existsSync(/* turbopackIgnore: true */ path)) throw new Error(`三份手册完整性校验失败：${name} 缺失`);
      const content = readFileSync(/* turbopackIgnore: true */ path, "utf8");
      contents.set(path, content);
      const actual = sha256(content);
      if (expected.get(name) !== actual) {
        throw new Error(`三份手册完整性校验失败：${name} hash 不一致`);
      }
      return Object.freeze({ path, sha256: actual, characters: content.length, ok: true as const });
    });
    const context = records
      .map((record) => contents.get(record.path) ?? "")
      .join(manualSeparator);
    return Object.freeze({ stage: "v0.2-b", records: Object.freeze(records), context });
  }

  load(stage: "v0.2-b"): ProtectedManualContext {
    this.snapshot ??= this.readSnapshot();
    void stage;
    return this.snapshot;
  }
}

/**
 * Owns the protected manual snapshot for each product flow.
 *
 * A flow reads and verifies the source manuals only on its first acquire. All
 * later stages, revisions and retries receive the exact same authority and
 * uncompressed snapshot. Releasing a completed flow permanently closes it in
 * this registry so an accidental late run cannot reopen the source manuals.
 */
export class ProductManualAuthorityRegistry {
  private readonly active = new Map<string, ProductManualContext>();
  private readonly closed = new Set<string>();
  private readonly failures = new Map<string, string>();

  constructor(
    private readonly projectRoot: string,
    private readonly store?: ProductManualSnapshotStore,
    private readonly issuanceStore?: ProductManualIssuanceStore
  ) {}

  acquire(productFlowId: string): ProductManualContext {
    const normalizedId = productFlowId.trim();
    if (!normalizedId) throw new Error("产品流程 ID 不能为空");
    if (this.closed.has(normalizedId)) {
      throw new Error("产品流程已完成或终止，禁止重新读取三份原始手册");
    }
    const previousFailure = this.failures.get(normalizedId);
    if (previousFailure) throw new Error(previousFailure);
    const existing = this.active.get(normalizedId);
    if (existing) return existing;

    let authority: ManualAuthority;
    let snapshot: ProtectedManualContext;
    try {
      if (this.store) {
        const issuance = this.issuanceStore?.begin(normalizedId);
        if (issuance && !issuance.owner && issuance.state === "closed") {
          this.closed.add(normalizedId);
          throw new Error("产品流程已完成或终止，禁止重新读取三份原始手册");
        }
        let stored: StoredProductManualSnapshot;
        if (issuance && !issuance.owner) {
          const existingSnapshot = this.store.loadExisting(normalizedId);
          if (!existingSnapshot) {
            const failure = "三份原始手册快照已签发，但私有快照缺失；本产品流程已终止，请新建产品流程重试";
            this.store.fail(normalizedId, failure);
            throw new Error(failure);
          }
          stored = existingSnapshot;
        } else {
          try {
            stored = this.store.loadOrCreate(
              normalizedId,
              () => new ManualAuthority(this.projectRoot).load("v0.2-b")
            );
          } finally {
            if (issuance?.owner) this.issuanceStore?.finish(normalizedId, issuance.token);
          }
        }
        if (stored.state === "closed") {
          this.closed.add(normalizedId);
          throw new Error("产品流程已完成或终止，禁止重新读取三份原始手册");
        }
        if (stored.state === "failed") {
          throw new Error(
            `三份原始手册首次读取失败，本产品流程已终止；请新建产品流程重试：${stored.error}`
          );
        }
        try {
          snapshot = restoreSnapshot(stored.snapshot);
        } catch (error) {
          const failure =
            `三份手册持久快照完整性校验失败，本产品流程已停止；请新建产品流程重试：${errorMessage(error)}`
          this.store.fail(normalizedId, failure);
          this.failures.set(normalizedId, failure);
          throw new Error(failure);
        }
        authority = new ManualAuthority(this.projectRoot, snapshot);
      } else {
        authority = new ManualAuthority(this.projectRoot);
        snapshot = authority.load("v0.2-b");
      }
    } catch (error) {
      const message = errorMessage(error);
      if (!this.closed.has(normalizedId)) this.failures.set(normalizedId, message);
      throw error;
    }
    const entry = Object.freeze({
      productFlowId: normalizedId,
      authority,
      snapshot
    });
    this.active.set(normalizedId, entry);
    return entry;
  }

  release(productFlowId: string): boolean {
    const normalizedId = productFlowId.trim();
    if (!normalizedId) return false;
    const released = this.active.delete(normalizedId);
    this.failures.delete(normalizedId);
    this.closed.add(normalizedId);
    this.store?.release(normalizedId);
    this.issuanceStore?.markClosed(normalizedId);
    return released;
  }

  isActive(productFlowId: string): boolean {
    return this.active.has(productFlowId.trim());
  }

  isClosed(productFlowId: string): boolean {
    return this.closed.has(productFlowId.trim());
  }

  activeFlowIds(): string[] {
    return [...new Set([
      ...this.active.keys(),
      ...(this.store?.activeFlowIds() ?? [])
    ])];
  }
}
