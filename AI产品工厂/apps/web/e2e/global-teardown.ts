import { rmSync } from "node:fs";
import { basename } from "node:path";

export default function globalTeardown() {
  const dataDir = process.env.FACTORY_E2E_DATA_DIR;
  if (!dataDir || !basename(dataDir).startsWith("naxe-factory-e2e-")) return;
  rmSync(dataDir, { recursive: true, force: true });
}
