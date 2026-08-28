import { basename } from "node:path";
import { readArtifactContent, SqliteHarnessRecordStore } from "@factory/records";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  return params.then(async ({ id, artifactId }) => {
    const records = new SqliteHarnessRecordStore();
    const harness = records.getHarnessRunForProductionRun(id);
    const artifact = records.getArtifact(artifactId);
    if (!harness || !artifact || artifact.runId !== harness.id || artifact.status !== "ready") {
      return Response.json({ error: { code: "artifact_not_found", message: "产物不存在", retryable: false } }, { status: 404 });
    }
    try {
      const content = await readArtifactContent(artifact);
      const body = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
      return new Response(body, {
      headers: {
        "Content-Type": artifact.mimeType,
        "Content-Disposition": `inline; filename="${basename(artifact.path).replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff"
      }
      });
    } catch {
      return Response.json({ error: { code: "artifact_unavailable", message: "产物暂时无法读取", retryable: true } }, { status: 503 });
    }
  });
}
