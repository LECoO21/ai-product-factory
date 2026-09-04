import { cpSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProductManualAuthorityRegistry } from "@factory/harness";
import {
  SqliteProductManualIssuanceStore,
  SqliteProductManualSnapshotStore
} from "@factory/records";

const sourceProjectRoot = join(import.meta.dirname, "../../..");
const manualNames = [
  "AI产品Vibe Coding通用技术栈手册.md",
  "AI产品Vibe Coding通用前端技术栈手册.md",
  "AI Agent 产品上线部署手册.md"
] as const;

const copyAuthority = () => {
  const root = mkdtempSync(join(tmpdir(), "factory-manual-recovery-"));
  const projectRoot = join(root, "AI产品工厂");
  cpSync(join(sourceProjectRoot, "docs"), join(projectRoot, "docs"), { recursive: true });
  for (const name of manualNames) {
    cpSync(join(sourceProjectRoot, "..", name), join(root, name));
  }
  return { root, projectRoot };
};

describe("product manual backup recovery", () => {
  it("does not reread originals when factory.sqlite is restored without the private snapshot DB", () => {
    const { root, projectRoot } = copyAuthority();
    const factoryDatabasePath = join(root, "data", "factory.sqlite");
    const manualDatabasePath = join(root, "private", "manual-authority.sqlite");
    const issuance = new SqliteProductManualIssuanceStore(factoryDatabasePath);
    const snapshots = new SqliteProductManualSnapshotStore(manualDatabasePath);
    const first = new ProductManualAuthorityRegistry(projectRoot, snapshots, issuance);
    expect(first.acquire("product-restored").snapshot.context.length).toBeGreaterThan(1_000);
    snapshots.close();
    issuance.close();

    unlinkSync(manualDatabasePath);
    const sourceManual = join(root, manualNames[0]);
    writeFileSync(sourceManual, `${readFileSync(sourceManual, "utf8")}\nMUST-NOT-BE-REREAD`);

    const restoredIssuance = new SqliteProductManualIssuanceStore(factoryDatabasePath);
    const missingSnapshots = new SqliteProductManualSnapshotStore(manualDatabasePath);
    const restored = new ProductManualAuthorityRegistry(
      projectRoot,
      missingSnapshots,
      restoredIssuance
    );
    expect(() => restored.acquire("product-restored")).toThrow(/已签发.*私有快照缺失/);
    expect(missingSnapshots.loadExisting("product-restored")).toMatchObject({
      state: "failed",
      snapshot: null
    });
    missingSnapshots.close();
    restoredIssuance.close();
  });
});
