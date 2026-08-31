import { NextResponse } from "next/server";
import { z } from "zod";
import { createProductionController } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";
import { apiError } from "@/lib/api/server-error";

const inputSchema = z.object({
  feedback: z.string().trim().min(1).max(2000)
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "请填写补充回答或修改意见", 400);
  try {
    const result = createProductionController(new SqliteProductionRunStore())
      .reviseFromFeedback(id, parsed.data.feedback);
    return NextResponse.json({ run: result.revisionRun }, { status: 201 });
  } catch (error) {
    return apiError(
      "RUN_REVISION_NOT_ALLOWED",
      error instanceof Error ? error.message : "无法根据反馈重新分析",
      409
    );
  }
}
