import { NextResponse } from "next/server";
import { z } from "zod";
import { SqliteCodexRuntimeStore } from "@factory/records";
import { apiError } from "@/lib/api/server-error";
import { isSameOriginAccountMutation } from "@/lib/auth/same-origin";

export const dynamic = "force-dynamic";

const cancelSchema = z.object({ loginId: z.string().trim().min(1).max(200) });

export async function POST(request: Request) {
  if (!isSameOriginAccountMutation(request)) {
    return apiError("CROSS_SITE_REQUEST_REJECTED", "请求来源无效，请从产品工厂页面重试", 403);
  }
  const parsed = cancelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_LOGIN_ID", "登录任务无效，请重新登录", 400);

  let store: SqliteCodexRuntimeStore | null = null;
  try {
    store = new SqliteCodexRuntimeStore();
    const command = store.createCommand({
      type: "account.login.cancel",
      payload: { loginId: parsed.data.loginId }
    });
    return NextResponse.json({ command }, { status: 202 });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "codex_auth.login_cancel_command_failed",
      errorType: error instanceof Error ? error.name : "unknown"
    }));
    return apiError("CODEX_RUNTIME_UNAVAILABLE", "暂时无法取消登录", 503);
  } finally {
    store?.close();
  }
}
