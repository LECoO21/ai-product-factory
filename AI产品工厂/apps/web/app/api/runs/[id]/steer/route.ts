import { NextResponse } from "next/server";
import { z } from "zod";
import { SqliteProductionRunStore } from "@factory/records";
import { RuntimeCommandGateway } from "@factory/runtime-core";
import { apiError } from "@/lib/api/server-error";

const inputSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().min(8).max(100)
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = new SqliteProductionRunStore();
  const run = store.get(id);
  if (!run) return apiError("RUN_NOT_FOUND", "运行不存在", 404);
  if (run.status !== "running") {
    return apiError("RUN_NOT_ACTIVE", "当前运行不能接收调整指令", 409);
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "请填写要调整的内容", 400);
  try {
    const receipt = new RuntimeCommandGateway(store).submit({
      id: parsed.data.idempotencyKey,
      type: "turn.steer",
      threadId: run.projectId,
      turnId: run.id,
      message: parsed.data.message
    });
    return NextResponse.json({ receipt });
  } catch (error) {
    return apiError(
      "RUN_COMMAND_REJECTED",
      error instanceof Error ? error.message : "调整指令未被接受",
      409
    );
  }
}
