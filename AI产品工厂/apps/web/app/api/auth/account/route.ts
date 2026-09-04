import { NextResponse } from "next/server";
import { SqliteCodexRuntimeStore } from "@factory/records";
import { apiError } from "@/lib/api/server-error";

export const dynamic = "force-dynamic";

export function GET() {
  let store: SqliteCodexRuntimeStore | null = null;
  try {
    store = new SqliteCodexRuntimeStore();
    const snapshot = store.getAccountSnapshot();
    return NextResponse.json(
      snapshot ?? {
        authenticated: false,
        accountType: null,
        emailHint: null,
        planType: null,
        requiresOpenaiAuth: true,
        capturedAt: null,
        updatedAt: null
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "codex_auth.account_read_failed",
      errorType: error instanceof Error ? error.name : "unknown"
    }));
    return apiError("CODEX_RUNTIME_UNAVAILABLE", "无法读取 OpenAI 登录状态", 503);
  } finally {
    store?.close();
  }
}
