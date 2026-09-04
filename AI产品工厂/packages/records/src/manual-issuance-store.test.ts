import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteProductManualIssuanceStore } from "./manual-issuance-store";

const createDatabasePath = (): string =>
  join(mkdtempSync(join(tmpdir(), "factory-manual-issuance-")), "factory.sqlite");

describe("SqliteProductManualIssuanceStore", () => {
  it("persists the non-secret issued marker across factory database restarts", () => {
    const databasePath = createDatabasePath();
    const first = new SqliteProductManualIssuanceStore(databasePath);
    const claim = first.begin("product-a");
    expect(claim).toMatchObject({ owner: true, token: expect.any(String) });
    if (!claim.owner) throw new Error("expected issuance owner");
    first.finish("product-a", claim.token);
    first.close();

    const restored = new SqliteProductManualIssuanceStore(databasePath);
    expect(restored.begin("product-a")).toEqual({ owner: false, state: "issued" });
    restored.markClosed("product-a");
    expect(restored.begin("product-a")).toEqual({ owner: false, state: "closed" });
    restored.close();
  });
});
