import { NextResponse } from "next/server";
import { z } from "zod";
import { SqliteProductionRunStore } from "@factory/records";
import { RuntimeCommandGateway } from "@factory/runtime-core";
import { apiError } from "@/lib/api/server-error";

const inputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().min(8).max(100)
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = new SqliteProductionRunStore();
  const run = store.get(id);
  if (!run) return apiError("RUN_NOT_FOUND", "运行不存在", 404);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "停止原因无效", 400);
  const existing = store.events(id).find(
    (event) =>
      event.type === "harness.command.abort" &&
      event.payload.idempotencyKey === parsed.data.idempotencyKey
  );
  if (existing) {
    return NextResponse.json({
      receipt: {
        accepted: true,
        commandId: parsed.data.idempotencyKey,
        commandSequence: existing.sequence,
        duplicate: true
      }
    });
  }
  if (run.status === "ready" || run.status === "waiting_approval" || run.status === "succeeded") {
    const command = store.append(id, "harness.command.abort", parsed.data);
    store.transition(id, "cancelled", parsed.data.reason);
    return NextResponse.json({
      receipt: {
        accepted: true,
        commandId: parsed.data.idempotencyKey,
        commandSequence: command.sequence,
        duplicate: false
      }
    });
  }
  if (run.status !== "running") {
    return apiError("RUN_NOT_ACTIVE", "当前运行已经停止", 409);
  }
  try {
    const receipt = new RuntimeCommandGateway(store).submit({
      id: parsed.data.idempotencyKey,
      type: "turn.interrupt",
      threadId: run.projectId,
      turnId: run.id,
      reason: parsed.data.reason
    });
    return NextResponse.json({ receipt });
  } catch (error) {
    return apiError(
      "RUN_COMMAND_REJECTED",
      error instanceof Error ? error.message : "停止指令未被接受",
      409
    );
  }
}
