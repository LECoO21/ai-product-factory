import { SqliteCodexRuntimeStore } from "@factory/records";
import {
  isCodexAccountAuthenticated,
  isFactoryAuthBypassed
} from "./session";

export async function isCurrentRequestAuthenticated() {
  if (isFactoryAuthBypassed()) return true;
  let store: SqliteCodexRuntimeStore | null = null;
  try {
    store = new SqliteCodexRuntimeStore();
    return isCodexAccountAuthenticated(store.getAccountSnapshot());
  } catch {
    return false;
  } finally {
    store?.close();
  }
}
