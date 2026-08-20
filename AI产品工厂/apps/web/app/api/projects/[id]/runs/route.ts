import { NextResponse } from "next/server";
import { getProductFactory } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProductFactory().getProject(id)) {
    return NextResponse.json({ error: "产品项目不存在" }, { status: 404 });
  }
  const input = (await request.json().catch(() => ({}))) as { objective?: string };
  const objective = input.objective?.trim() || "执行 PRD 接单体检";
  const run = new SqliteProductionRunStore().create(id, objective);
  return NextResponse.json({ run }, { status: 201 });
}
