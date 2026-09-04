import { NextResponse } from "next/server";
import { SqliteCodexRuntimeStore } from "@factory/records";
import { apiError } from "@/lib/api/server-error";
import { isSameOriginAccountMutation } from "@/lib/auth/same-origin";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  if (!isSameOriginAccountMutation(request)) {
    return apiError("CROSS_SITE_REQUEST_REJECTED", "请求来源无效，请从产品工厂页面重试", 403);
  }
  let store: SqliteCodexRuntimeStore | null = null;
  try {
    store = new SqliteCodexRuntimeStore();
    const command = store.createCommand({ type: "account.logout", payload: {} });
    return NextResponse.json({ command }, { status: 202 });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "codex_auth.logout_command_failed",
      errorType: error instanceof Error ? error.name : "unknown"
    }));
    return apiError("CODEX_RUNTIME_UNAVAILABLE", "Codex 退出服务暂时不可用", 503);
  } finally {
    store?.close();
  }
}
