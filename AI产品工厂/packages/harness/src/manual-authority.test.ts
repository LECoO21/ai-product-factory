import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ManualAuthority,
  ProductManualAuthorityRegistry,
  type ProductManualIssuanceStore,
  type ProductManualSnapshotStore,
  type StoredProductManualSnapshot
} from "./manual-authority";

const originalRoot = join(import.meta.dirname, "../../../..");
const manualNames = [
  "AI产品Vibe Coding通用技术栈手册.md",
  "AI产品Vibe Coding通用前端技术栈手册.md",
  "AI Agent 产品上线部署手册.md"
] as const;

const copyAuthority = () => {
  const root = mkdtempSync(join(tmpdir(), "factory-manuals-"));
  const projectRoot = join(root, "AI产品工厂");
  cpSync(join(originalRoot, "AI产品工厂", "docs"), join(projectRoot, "docs"), { recursive: true });
  for (const name of manualNames) cpSync(join(originalRoot, name), join(root, name));
  return { root, projectRoot };
};

class MemoryManualSnapshotStore implements ProductManualSnapshotStore {
  private readonly rows = new Map<string, StoredProductManualSnapshot>();
  createCalls = 0;

  loadOrCreate(
    productFlowId: string,
    createSnapshot: () => unknown
  ): StoredProductManualSnapshot {
    const existing = this.rows.get(productFlowId);
    if (existing) return existing;
    this.createCalls += 1;
    try {
      const row = {
        state: "active" as const,
        snapshot: JSON.parse(JSON.stringify(createSnapshot())) as unknown,
        error: null
      };
      this.rows.set(productFlowId, row);
      return row;
    } catch (error) {
      const row = {
        state: "failed" as const,
        snapshot: null,
        error: error instanceof Error ? error.message : "首次读取失败"
      };
      this.rows.set(productFlowId, row);
      return row;
    }
  }

  loadExisting(productFlowId: string): StoredProductManualSnapshot | null {
    return this.rows.get(productFlowId) ?? null;
  }

  release(productFlowId: string): void {
    this.rows.set(productFlowId, { state: "closed", snapshot: null, error: null });
  }

  fail(productFlowId: string, error: string): void {
    this.rows.set(productFlowId, { state: "failed", snapshot: null, error });
  }

  activeFlowIds(): string[] {
    return [...this.rows.entries()]
      .filter(([, row]) => row.state === "active")
      .map(([productFlowId]) => productFlowId);
  }

  replaceActiveSnapshot(productFlowId: string, snapshot: unknown): void {
    this.rows.set(productFlowId, { state: "active", snapshot, error: null });
  }

  get(productFlowId: string): StoredProductManualSnapshot | null {
    return this.rows.get(productFlowId) ?? null;
  }
}

class MemoryManualIssuanceStore implements ProductManualIssuanceStore {
  private readonly states = new Map<string, "issued" | "closed">();

  begin(productFlowId: string) {
    const state = this.states.get(productFlowId);
    if (state) return { owner: false as const, state };
    return { owner: true as const, token: `issue:${productFlowId}` };
  }

  finish(productFlowId: string, _token: string): void {
    this.states.set(productFlowId, "issued");
  }

  markClosed(productFlowId: string): void {
    this.states.set(productFlowId, "closed");
  }
}

describe("ManualAuthority", () => {
  it("loads all manuals in fixed order without returning full text in public records", () => {
    const { projectRoot } = copyAuthority();
    const loaded = new ManualAuthority(projectRoot).load("v0.2-b");

    expect(loaded.records.map((record) => basename(record.path))).toEqual(manualNames);
    expect(loaded.context).toContain("AI Agent 产品 Vibe Coding 通用技术栈手册");
    expect(JSON.stringify(loaded.records)).not.toContain("三份手册的总地图");
    expect(loaded.records.every((record) => record.characters > 500)).toBe(true);
  });

  it("blocks on a hash mismatch before exposing context", () => {
    const { root, projectRoot } = copyAuthority();
    const path = join(root, manualNames[0]);
    writeFileSync(path, `${readFileSync(path, "utf8")}\nchanged`);
    expect(() => new ManualAuthority(projectRoot).load("v0.2-b")).toThrow(/完整性校验失败/);
  });

  it("locks one complete snapshot and reuses it during the same product process", () => {
    const { root, projectRoot } = copyAuthority();
    const authority = new ManualAuthority(projectRoot);
    const first = authority.load("v0.2-b");
    const path = join(root, manualNames[0]);
    writeFileSync(path, `${readFileSync(path, "utf8")}\nchanged-after-lock`);

    expect(authority.load("v0.2-b")).toEqual(first);
    expect(() => new ManualAuthority(projectRoot).load("v0.2-b")).toThrow(/完整性校验失败/);
  });

  it("loads manuals from a private deployment directory", () => {
    const { root, projectRoot } = copyAuthority();
    const previous = process.env.FACTORY_MANUALS_DIR;
    process.env.FACTORY_MANUALS_DIR = root;
    cpSync(join(projectRoot, "docs", "MANUALS.sha256"), join(root, "MANUALS.sha256"));
    try {
      expect(new ManualAuthority(projectRoot).verify()).toHaveLength(3);
    } finally {
      if (previous === undefined) delete process.env.FACTORY_MANUALS_DIR;
      else process.env.FACTORY_MANUALS_DIR = previous;
    }
  });
});

describe("ProductManualAuthorityRegistry", () => {
  it("locks one independent snapshot per product flow and reuses it", () => {
    const { projectRoot } = copyAuthority();
    const registry = new ProductManualAuthorityRegistry(projectRoot);

    const first = registry.acquire("product-a");
    const repeated = registry.acquire("product-a");
    const secondProduct = registry.acquire("product-b");

    expect(repeated).toBe(first);
    expect(repeated.snapshot).toBe(first.snapshot);
    expect(repeated.authority).toBe(first.authority);
    expect(secondProduct).not.toBe(first);
    expect(secondProduct.authority).not.toBe(first.authority);
    expect(registry.activeFlowIds()).toEqual(["product-a", "product-b"]);
  });

  it("releases a completed flow without rereading its manuals", () => {
    const { root, projectRoot } = copyAuthority();
    const registry = new ProductManualAuthorityRegistry(projectRoot);
    registry.acquire("product-a");
    const path = join(root, manualNames[0]);
    writeFileSync(path, `${readFileSync(path, "utf8")}\nchanged-after-completion`);

    expect(registry.release("product-a")).toBe(true);
    expect(registry.isActive("product-a")).toBe(false);
    expect(registry.isClosed("product-a")).toBe(true);
    expect(() => registry.acquire("product-a")).toThrow(/禁止重新读取/);
    expect(() => registry.acquire("product-b")).toThrow(/完整性校验失败/);
  });

  it("closes an already completed flow before any manual read", () => {
    const { root, projectRoot } = copyAuthority();
    const registry = new ProductManualAuthorityRegistry(projectRoot);
    const path = join(root, manualNames[0]);
    writeFileSync(path, `${readFileSync(path, "utf8")}\nchanged-before-worker-recovery`);

    expect(registry.release("product-completed")).toBe(false);
    expect(registry.isClosed("product-completed")).toBe(true);
    expect(() => registry.acquire("product-completed")).toThrow(/禁止重新读取/);
  });

  it("restores one persisted snapshot after a Worker restart without rereading disk", () => {
    const { root, projectRoot } = copyAuthority();
    const store = new MemoryManualSnapshotStore();
    const first = new ProductManualAuthorityRegistry(projectRoot, store).acquire("product-a");
    const path = join(root, manualNames[0]);
    writeFileSync(path, `${readFileSync(path, "utf8")}\nchanged-after-worker-stop`);

    const restored = new ProductManualAuthorityRegistry(projectRoot, store).acquire("product-a");

    expect(restored.snapshot.context).toBe(first.snapshot.context);
    expect(store.createCalls).toBe(1);
  });

  it("keeps a completed-flow tombstone across Registry restarts", () => {
    const { projectRoot } = copyAuthority();
    const store = new MemoryManualSnapshotStore();
    const firstRegistry = new ProductManualAuthorityRegistry(projectRoot, store);
    firstRegistry.acquire("product-a");
    firstRegistry.release("product-a");

    expect(store.activeFlowIds()).toEqual([]);
    expect(() =>
      new ProductManualAuthorityRegistry(projectRoot, store).acquire("product-a")
    ).toThrow(/禁止重新读取/);
    expect(store.createCalls).toBe(1);
  });

  it("blocks on a corrupt persisted snapshot instead of rereading source manuals", () => {
    const { projectRoot } = copyAuthority();
    const store = new MemoryManualSnapshotStore();
    const first = new ProductManualAuthorityRegistry(projectRoot, store).acquire("product-a");
    store.replaceActiveSnapshot("product-a", {
      ...first.snapshot,
      context: `${first.snapshot.context}tampered`
    });

    expect(() =>
      new ProductManualAuthorityRegistry(projectRoot, store).acquire("product-a")
    ).toThrow(/持久快照完整性校验失败/);
    expect(store.get("product-a")).toMatchObject({
      state: "failed",
      snapshot: null,
      error: expect.stringMatching(/持久快照完整性校验失败/)
    });
    expect(() =>
      new ProductManualAuthorityRegistry(projectRoot, store).acquire("product-a")
    ).toThrow(/本产品流程已终止/);
    expect(store.createCalls).toBe(1);
  });

  it("persists a failed first read and never retries the original manuals", () => {
    const { root, projectRoot } = copyAuthority();
    const store = new MemoryManualSnapshotStore();
    const path = join(root, manualNames[0]);
    writeFileSync(path, `${readFileSync(path, "utf8")}\nbroken-on-first-read`);
    expect(() =>
      new ProductManualAuthorityRegistry(projectRoot, store).acquire("product-a")
    ).toThrow(/首次读取失败/);

    cpSync(join(originalRoot, manualNames[0]), path);
    expect(() =>
      new ProductManualAuthorityRegistry(projectRoot, store).acquire("product-a")
    ).toThrow(/本产品流程已终止；请新建产品流程重试/);
    expect(store.createCalls).toBe(1);
  });

  it("fails closed when the issued ledger is restored without the private snapshot", () => {
    const { projectRoot } = copyAuthority();
    const snapshots = new MemoryManualSnapshotStore();
    const issuance = new MemoryManualIssuanceStore();
    const prior = issuance.begin("product-restored");
    if (!prior.owner) throw new Error("expected issuance owner");
    issuance.finish("product-restored", prior.token);

    expect(() => new ProductManualAuthorityRegistry(
      projectRoot,
      snapshots,
      issuance
    ).acquire("product-restored")).toThrow(/已签发.*私有快照缺失/);
    expect(snapshots.createCalls).toBe(0);
    expect(snapshots.get("product-restored")).toMatchObject({
      state: "failed",
      snapshot: null
    });
  });
});
