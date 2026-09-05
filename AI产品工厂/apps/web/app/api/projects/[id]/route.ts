import { NextResponse } from "next/server";
import { SqliteProjectRegistry } from "@factory/records";
import { apiError } from "@/lib/api/server-error";
import { isSameOriginAccountMutation as isSameOriginMutation } from "@/lib/auth/same-origin";
import { finalizeProductFlowResources } from "@/lib/product-flow-lifecycle.server";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(request)) return apiError("INVALID_ORIGIN", "请从产品页面删除产品", 403);
  const { id } = await params;
  const registry = new SqliteProjectRegistry();
  try {
    const result = registry.deleteProject(id);
    if (result === "not_found") return apiError("PROJECT_NOT_FOUND", "产品不存在", 404);
    if (result === "running") return apiError("PROJECT_RUNNING", "任务正在运行，请先在对话中终止流程，再删除产品", 409);
    // Idempotent: retrying an already deleted product retries terminal cleanup too.
    finalizeProductFlowResources(id);
    return NextResponse.json({ deleted: true });
  } catch {
    return apiError("PROJECT_DELETE_FAILED", "未能完成删除，请重试", 500);
  } finally {
    registry.close();
  }
}
