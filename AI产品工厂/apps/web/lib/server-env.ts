import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const factoryEnvFile = fileURLToPath(new URL("../../../.env", import.meta.url));
let loaded = false;

export const loadFactoryEnvironment = () => {
  if (loaded) return;
  loaded = true;
  if (existsSync(factoryEnvFile)) process.loadEnvFile(factoryEnvFile);
};
