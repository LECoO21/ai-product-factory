import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = dirname(projectRoot);
const standaloneRoot = join(projectRoot, "apps", "web", ".next", "standalone");
const standaloneWeb = join(standaloneRoot, "apps", "web");
const privateManualRoot = join(standaloneRoot, "manuals-internal");
const checksumPath = join(projectRoot, "docs", "MANUALS.sha256");
const manualNames = [
  "AI产品Vibe Coding通用技术栈手册.md",
  "AI产品Vibe Coding通用前端技术栈手册.md",
  "AI Agent 产品上线部署手册.md"
];
const platform = process.argv.includes("--platform=local") ? "local" : "linux-x64-node20";

if (!existsSync(join(standaloneWeb, "server.js"))) {
  throw new Error("Next.js standalone 产物不存在，请先运行 npm run build");
}

mkdirSync(join(standaloneWeb, ".next"), { recursive: true });
cpSync(
  join(projectRoot, "apps", "web", ".next", "static"),
  join(standaloneWeb, ".next", "static"),
  { recursive: true }
);
if (existsSync(join(projectRoot, "apps", "web", "public"))) {
  cpSync(join(projectRoot, "apps", "web", "public"), join(standaloneWeb, "public"), { recursive: true });
}
cpSync(
  join(projectRoot, "tests", "fixtures", "harness-loop"),
  join(standaloneRoot, "tests", "fixtures", "harness-loop"),
  { recursive: true }
);

const expected = new Map(
  readFileSync(checksumPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
      if (!match) throw new Error("MANUALS.sha256 格式错误");
      return [basename(match[2]), match[1]];
    })
);

mkdirSync(privateManualRoot, { recursive: true });
const manuals = manualNames.map((name) => {
  const source = join(workspaceRoot, name);
  const content = readFileSync(source);
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (sha256 !== expected.get(name)) throw new Error(`三份手册完整性校验失败：${name}`);
  cpSync(source, join(privateManualRoot, name));
  return { name, sha256, bytes: content.byteLength };
});
cpSync(checksumPath, join(privateManualRoot, "MANUALS.sha256"));

const findPackageDirectories = (directory, packageName, results = []) => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (!statSync(path).isDirectory()) continue;
    if (entry === packageName && basename(dirname(path)) === "node_modules") results.push(path);
    else findPackageDirectories(path, packageName, results);
  }
  return results;
};

if (platform === "linux-x64-node20") {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "factory-linux-addon-"));
  try {
    const install = spawnSync(
      "npm",
      ["install", "better-sqlite3@12.4.1", "--prefix", temporaryRoot, "--no-save"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          npm_config_platform: "linux",
          npm_config_arch: "x64",
          npm_config_target: "20.19.0"
        }
      }
    );
    if (install.status !== 0) throw new Error("无法准备 Linux Node 20 SQLite 原生模块");
    const linuxAddon = join(
      temporaryRoot,
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node"
    );
    const packageDirectories = findPackageDirectories(standaloneRoot, "better-sqlite3");
    if (packageDirectories.length === 0) throw new Error("standalone 中缺少 better-sqlite3");
    for (const packageDirectory of packageDirectories) {
      const target = join(packageDirectory, "build", "Release", "better_sqlite3.node");
      mkdirSync(dirname(target), { recursive: true });
      cpSync(linuxAddon, target);
      const header = readFileSync(target).subarray(0, 4).toString("hex");
      if (header !== "7f454c46") throw new Error("SQLite 原生模块不是 Linux ELF 文件");
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const forbiddenNames = new Set([".env", ".env.local", ".git", ".vefaas"]);
const scan = (directory, root = false) => {
  for (const entry of readdirSync(directory)) {
    if (forbiddenNames.has(entry) || (root && entry === "data")) {
      throw new Error(`部署包包含禁止项：${entry}`);
    }
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) scan(path, false);
  }
};
scan(standaloneRoot, true);

writeFileSync(
  join(standaloneRoot, "deployment-manifest.json"),
  `${JSON.stringify({ version: 1, createdAt: new Date().toISOString(), platform, manuals }, null, 2)}\n`,
  "utf8"
);

console.log(JSON.stringify({ ok: true, output: standaloneRoot, platform, manuals: manuals.length }));
