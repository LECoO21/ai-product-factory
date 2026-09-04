import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const e2eDataDir = process.env.FACTORY_E2E_DATA_DIR || mkdtempSync(join(tmpdir(), "naxe-factory-e2e-"));
process.env.FACTORY_E2E_DATA_DIR = e2eDataDir;
process.env.FACTORY_DATA_DIR = e2eDataDir;
process.env.NEXT_DIST_DIR = ".next-e2e";
process.env.FACTORY_AUTH_BYPASS = "true";

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  globalSetup: "./apps/web/e2e/global-setup.ts",
  globalTeardown: "./apps/web/e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    channel: "chrome"
  },
  webServer: {
    command: "npm run dev --workspace @factory/web -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
