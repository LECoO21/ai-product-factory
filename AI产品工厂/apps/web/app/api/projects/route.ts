import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getProductFactory } from "@factory/production";
import { projectCreateInputSchema } from "@factory/shared";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ projects: getProductFactory().listProjects() });
}

export async function POST(request: Request) {
  try {
    const input = projectCreateInputSchema.parse(await request.json());
    const project = getProductFactory().createProject(input);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "产品项目信息不完整" },
        { status: 400 }
      );
    }
    console.error("Failed to create product project", error);
    return NextResponse.json({ error: "创建产品项目失败，请检查本地工厂状态。" }, { status: 500 });
  }
}
