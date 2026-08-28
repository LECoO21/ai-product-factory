import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const findFactoryRoot = (start: string): string => {
  let current = resolve(start);
  while (true) {
    const manifest = join(current, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
        if (parsed.name === "ai-product-factory") return current;
      } catch {
        // Keep walking; a malformed unrelated package manifest is not our root.
      }
    }
    const parent = dirname(current);
    if (parent === current) throw new Error("无法定位 AI 产品工厂根目录");
    current = parent;
  }
};

export const defaultDatabasePath = () => {
  const configured = process.env.FACTORY_DATA_DIR?.trim();
  const dataDir = configured ? resolve(configured) : join(findFactoryRoot(process.cwd()), "data");
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, "factory.sqlite");
};
