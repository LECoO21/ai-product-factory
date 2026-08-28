import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ControlledCommandRunner, LocalWorkspace } from "./workspace";

const fixture = join(import.meta.dirname, "../../../tests/fixtures/harness-loop");

describe("LocalWorkspace", () => {
  it("reads, searches and applies hash-guarded unified patches", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-workspace-"));
    cpSync(fixture, directory, { recursive: true });
    const workspace = new LocalWorkspace(directory);
    const before = workspace.read({ path: "math.js" });

    expect(workspace.search({ query: "left + right" })[0]?.path).toBe("math.js");
    const result = workspace.patch({
      patch: [
        "--- a/math.js",
        "+++ b/math.js",
        "@@ -1,1 +1,1 @@",
        "-export const add = (left, right) => left + right;",
        "+export const add = (left, right) => left - right;",
        ""
      ].join("\n"),
      expectedHashes: { "math.js": before.sha256 }
    });

    expect(result.changed).toEqual(["math.js"]);
    expect(readFileSync(join(directory, "math.js"), "utf8")).toContain("left - right");
    expect(() => workspace.patch({ patch: result.diff, expectedHashes: { "math.js": before.sha256 } }))
      .toThrow(/hash 冲突/);
  });

  it("runs allowlisted commands with shell disabled and returns real exit codes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-command-"));
    cpSync(fixture, directory, { recursive: true });
    const workspace = new LocalWorkspace(directory);
    workspace.patch({
      patch: "--- a/math.js\n+++ b/math.js\n@@ -1,1 +1,1 @@\n-export const add = (left, right) => left + right;\n+export const add = (left, right) => left - right;\n",
      expectedHashes: { "math.js": workspace.read({ path: "math.js" }).sha256 }
    });
    const runner = new ControlledCommandRunner(directory);

    const failed = await runner.run({ program: "npm", args: ["test"], cwd: ".", timeoutMs: 30_000 });
    expect(failed.exitCode).not.toBe(0);
    await expect(runner.run({ program: "sh", args: ["-c", "rm -rf ."], cwd: ".", timeoutMs: 1_000 }))
      .rejects.toThrow(/不允许/);
    await expect(runner.run({ program: "npm", args: ["test;", "echo", "bad"], cwd: ".", timeoutMs: 1_000 }))
      .rejects.toThrow(/元字符/);
  });
});
