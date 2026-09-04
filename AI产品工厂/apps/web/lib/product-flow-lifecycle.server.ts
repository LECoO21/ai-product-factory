import {
  closeProductManualSnapshot,
  markProductManualIssuanceClosed,
  SqliteCodexRuntimeStore
} from "@factory/records";

/** Persist every terminal cleanup signal, then erase the private manual body.
 * All steps are attempted so a failure in one store cannot skip the others;
 * the terminal HTTP action remains retryable and every operation is idempotent. */
export const finalizeProductFlowResources = (productFlowId: string): void => {
  const failures: unknown[] = [];
  const codex = new SqliteCodexRuntimeStore();
  try {
    codex.enqueueProductThreadCleanups(productFlowId);
  } catch (error) {
    failures.push(error);
  } finally {
    codex.close();
  }
  try {
    markProductManualIssuanceClosed(productFlowId);
  } catch (error) {
    failures.push(error);
  }
  try {
    closeProductManualSnapshot(productFlowId);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "产品流程终态资源清理未完整登记");
  }
};
