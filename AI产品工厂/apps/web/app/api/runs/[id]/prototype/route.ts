import { SqliteProductionRunStore } from "@factory/records";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = new SqliteProductionRunStore();
  if (!store.get(id)) return new Response("生产批次不存在", { status: 404 });

  const artifact = [...store.events(id)]
    .reverse()
    .find(
      (event) =>
        event.type === "artifact.created" && event.payload.kind === "product-prototype-html"
    );
  const content = artifact?.payload.content;
  if (typeof content !== "string" || !content.trim()) {
    return new Response("当前产品还没有可验收的基础 HTML", { status: 404 });
  }

  return new Response(content, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": [
        "default-src 'none'",
        "style-src 'unsafe-inline'",
        "script-src 'unsafe-inline'",
        "img-src data:",
        `connect-src ${new URL(request.url).origin}/api/v1/recommend`,
        "font-src 'none'",
        "frame-ancestors 'self'",
        "form-action 'none'",
        "base-uri 'none'"
      ].join("; "),
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
