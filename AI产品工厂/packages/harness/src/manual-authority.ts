import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const manualNames = [
  "AI产品Vibe Coding通用技术栈手册.md",
  "AI产品Vibe Coding通用前端技术栈手册.md",
  "AI Agent 产品上线部署手册.md"
] as const;

export type ManualLoadRecord = {
  path: string;
  sha256: string;
  characters: number;
  ok: true;
};

export type ProtectedManualContext = {
  stage: "v0.2-b";
  records: ManualLoadRecord[];
  context: string;
};

const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

export class ManualAuthority {
  constructor(private readonly projectRoot: string) {}

  verify(): ManualLoadRecord[] {
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
    return manualNames.map((name) => {
      const path = join(/* turbopackIgnore: true */ authorityRoot, name);
      if (!existsSync(/* turbopackIgnore: true */ path)) throw new Error(`三份手册完整性校验失败：${name} 缺失`);
      const content = readFileSync(/* turbopackIgnore: true */ path, "utf8");
      const actual = sha256(content);
      if (expected.get(name) !== actual) {
        throw new Error(`三份手册完整性校验失败：${name} hash 不一致`);
      }
      return { path, sha256: actual, characters: content.length, ok: true as const };
    });
  }

  load(stage: "v0.2-b"): ProtectedManualContext {
    const records = this.verify();
    const context = records
      .map((record) => readFileSync(/* turbopackIgnore: true */ record.path, "utf8"))
      .join("\n\n--- 下一份原始手册 ---\n\n");
    return { stage, records, context };
  }
}
