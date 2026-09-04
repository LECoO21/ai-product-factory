import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

const sha256 = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");
const isInside = (root: string, path: string) => path === root || path.startsWith(`${root}${sep}`);

type PatchFile = { path: string; hunks: string[][] };

const parsePatch = (patch: string): PatchFile[] => {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: PatchFile[] = [];
  let current: PatchFile | null = null;
  let hunk: string[] | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("--- ")) continue;
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim().split("\t")[0] ?? "";
      if (raw === "/dev/null") throw new Error("workspace.patch 不允许删除文件");
      const path = raw.replace(/^[ab]\//, "");
      current = { path, hunks: [] };
      files.push(current);
      hunk = null;
      continue;
    }
    if (line.startsWith("@@ ")) {
      if (!current) throw new Error("unified patch 缺少目标文件");
      hunk = [line];
      current.hunks.push(hunk);
      continue;
    }
    if (hunk && (/^[ +\-]/.test(line) || line === "\\ No newline at end of file")) hunk.push(line);
  }
  if (files.length === 0 || files.some((file) => file.hunks.length === 0)) {
    throw new Error("unified patch 格式无效");
  }
  return files;
};

const applyHunks = (source: string, hunks: string[][]) => {
  const hadTrailingNewline = source.endsWith("\n");
  const original = source.replace(/\n$/, "").split("\n");
  const output = [...original];
  let offset = 0;
  for (const hunk of hunks) {
    const header = hunk[0]?.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!header?.[1]) throw new Error("unified patch hunk 格式无效");
    const cursor = Number(header[1]) - 1 + offset;
    const replacement: string[] = [];
    let consumed = 0;
    for (const line of hunk.slice(1)) {
      if (line === "\\ No newline at end of file") continue;
      const marker = line[0];
      const text = line.slice(1);
      if (marker === " " || marker === "-") {
        if (output[cursor + consumed] !== text) throw new Error("unified patch 上下文不匹配");
        consumed += 1;
      }
      if (marker === " " || marker === "+") replacement.push(text);
    }
    output.splice(cursor, consumed, ...replacement);
    offset += replacement.length - consumed;
  }
  return `${output.join("\n")}${hadTrailingNewline ? "\n" : ""}`;
};

export class LocalWorkspace {
  readonly root: string;

  constructor(root: string) {
    this.root = realpathSync(root);
  }

  private resolvePath(requested: string, mustExist = true) {
    const addressed = isAbsolute(requested) ? resolve(requested) : resolve(this.root, requested);
    if (mustExist && !existsSync(addressed)) throw new Error(`工作区文件不存在：${requested}`);
    const canonical = existsSync(addressed) ? realpathSync(addressed) : addressed;
    if (!isInside(this.root, canonical)) throw new Error("工作区路径越界");
    const name = basename(canonical);
    if (name === ".env" || name.startsWith(".env.")) throw new Error("秘密文件不允许访问");
    return canonical;
  }

  list(input: { path?: string; depth?: number; limit?: number } = {}) {
    const start = this.resolvePath(input.path ?? ".");
    const maxDepth = Math.min(input.depth ?? 2, 4);
    const limit = Math.min(input.limit ?? 200, 500);
    const entries: Array<{ path: string; kind: "file" | "directory" | "symlink"; size: number; mtimeMs: number }> = [];
    const visit = (directory: string, depth: number) => {
      for (const name of readdirSync(directory).sort()) {
        if (entries.length >= limit) return;
        const addressed = resolve(directory, name);
        const info = lstatSync(addressed);
        const kind = info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file";
        entries.push({ path: relative(this.root, addressed), kind, size: info.size, mtimeMs: info.mtimeMs });
        if (kind === "directory" && depth < maxDepth) visit(addressed, depth + 1);
      }
    };
    if (!statSync(start).isDirectory()) throw new Error("workspace.list 目标不是目录");
    visit(start, 0);
    return { entries, truncated: entries.length >= limit };
  }

  read(input: { path: string; startLine?: number; endLine?: number; maxBytes?: number }) {
    const path = this.resolvePath(input.path);
    const buffer = readFileSync(path);
    if (buffer.includes(0)) throw new Error("workspace.read 不支持二进制文件");
    const maxBytes = Math.min(input.maxBytes ?? 262_144, 262_144);
    const truncated = buffer.length > maxBytes;
    const fullText = buffer.subarray(0, maxBytes).toString("utf8");
    const lines = fullText.split("\n");
    const start = Math.max((input.startLine ?? 1) - 1, 0);
    const end = Math.min(input.endLine ?? lines.length, lines.length);
    return { path: relative(this.root, path), text: lines.slice(start, end).join("\n"),
      startLine: start + 1, endLine: end, sha256: sha256(buffer), truncated };
  }

  search(input: { query: string; paths?: string[]; limit?: number }) {
    const limit = Math.min(input.limit ?? 200, 200);
    const roots = (input.paths?.length ? input.paths : ["."]).map((path) => this.resolvePath(path));
    const matches: Array<{ path: string; line: number; excerpt: string }> = [];
    const files: string[] = [];
    const collect = (path: string) => {
      const info = lstatSync(path);
      if (info.isSymbolicLink()) return;
      if (info.isDirectory()) for (const name of readdirSync(path)) collect(resolve(path, name));
      else files.push(path);
    };
    roots.forEach(collect);
    for (const file of files.sort()) {
      const buffer = readFileSync(file);
      if (buffer.includes(0) || buffer.length > 262_144) continue;
      for (const [index, line] of buffer.toString("utf8").split("\n").entries()) {
        if (line.includes(input.query)) matches.push({ path: relative(this.root, file), line: index + 1, excerpt: line.slice(0, 500) });
        if (matches.length >= limit) return matches;
      }
    }
    return matches;
  }

  patch(input: { patch: string; expectedHashes: Record<string, string> }) {
    const files = parsePatch(input.patch);
    const changed: string[] = [];
    for (const file of files) {
      const path = this.resolvePath(file.path);
      const before = readFileSync(path, "utf8");
      const expected = input.expectedHashes[file.path];
      if (!expected || sha256(before) !== expected) throw new Error(`文件 hash 冲突：${file.path}`);
      const after = applyHunks(before, file.hunks);
      if (after === before) throw new Error(`patch 未产生变更：${file.path}`);
      writeFileSync(path, after, "utf8");
      changed.push(file.path);
    }
    return { changed, diff: input.patch, hashes: Object.fromEntries(changed.map((path) => [path, this.read({ path }).sha256])) };
  }
}

const allowedPrograms = new Set(["npm", "node", "git"]);
const unsafeArgument = /[;&|`\n\r]|\$\(|\$\{/;

export class ControlledCommandRunner {
  private readonly root: string;

  constructor(root: string) {
    this.root = realpathSync(root);
  }

  async run(input: { program: string; args: string[]; cwd: string; timeoutMs: number; signal?: AbortSignal }) {
    if (!allowedPrograms.has(input.program)) throw new Error(`程序不允许执行：${input.program}`);
    if (input.args.some((argument) => unsafeArgument.test(argument))) throw new Error("命令参数包含不允许的 Shell 元字符");
    if (input.program === "git" && !["status", "diff", "log"].includes(input.args[0] ?? "")) {
      throw new Error("只允许 Git status、diff、log");
    }
    const cwd = realpathSync(resolve(this.root, input.cwd));
    if (!isInside(this.root, cwd)) throw new Error("命令工作目录越界");
    const timeoutMs = Math.min(Math.max(input.timeoutMs, 1), 180_000);

    return new Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>((resolvePromise, reject) => {
      const started = Date.now();
      const child = spawn(input.program, input.args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      const abort = () => child.kill("SIGTERM");
      input.signal?.addEventListener("abort", abort, { once: true });
      child.once("error", (error) => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
        if (signal === "SIGTERM" && input.signal?.aborted) return reject(new Error("命令已取消"));
        if (signal === "SIGTERM") return reject(new Error("命令执行超时"));
        resolvePromise({ exitCode: code ?? 1, stdout, stderr, durationMs: Date.now() - started });
      });
    });
  }
}
