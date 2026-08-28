import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ManualAuthority } from "./manual-authority";

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
