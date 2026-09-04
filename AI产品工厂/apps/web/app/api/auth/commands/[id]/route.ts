import { NextResponse } from "next/server";
import { SqliteCodexRuntimeStore } from "@factory/records";
import { apiError } from "@/lib/api/server-error";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id || id.length > 200) {
    return apiError("INVALID_COMMAND_ID", "Codex 命令无效", 400);
  }

  let store: SqliteCodexRuntimeStore | null = null;
  try {
    store = new SqliteCodexRuntimeStore();
    const command = store.getCommand(id);
    if (!command) return apiError("COMMAND_NOT_FOUND", "Codex 命令不存在", 404);
    return NextResponse.json(
      { command },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "codex_auth.command_read_failed",
      errorType: error instanceof Error ? error.name : "unknown"
    }));
    return apiError("CODEX_RUNTIME_UNAVAILABLE", "无法读取 Codex 命令状态", 503);
  } finally {
    store?.close();
  }
}
