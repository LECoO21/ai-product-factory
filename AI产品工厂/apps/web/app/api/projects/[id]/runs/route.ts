import { NextResponse } from "next/server";
import { getProductFactory } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";
import { apiError } from "@/lib/api/server-error";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProductFactory().getProject(id)) {
    return apiError("PROJECT_NOT_FOUND", "产品项目不存在", 404);
  }
  try {
    const input = (await request.json().catch(() => ({}))) as { objective?: string };
    const objective = input.objective?.trim() || "执行 PRD 接单体检";
    const run = new SqliteProductionRunStore().create(id, objective);
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    console.error("Failed to start production run", error);
    return apiError("RUN_CREATE_FAILED", "无法启动生产批次", 500);
  }
}
