import Link from "next/link";
import { notFound } from "next/navigation";
import { SqliteProductionRunStore } from "@factory/records";
import { getProductFactory } from "@factory/production";
import { RunConsole } from "@/components/run-console";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = new SqliteProductionRunStore();
  const run = store.get(id);
  if (!run) notFound();
  const project = getProductFactory().getProject(run.projectId);
  if (!project) notFound();

  return (
    <div className="page">
      <header className="detail-header run-header">
        <Link href={`/projects/${project.id}`} className="back-link">
          ← 返回 {project.name}
        </Link>
        <span className="eyebrow">生产驾驶舱 / PRD 体检</span>
        <h1>{run.objective}</h1>
        <p>所有 Agent 与 Worker 事件都会先写入生产档案，再推送到这里。</p>
      </header>
      <RunConsole initialRun={run} initialEvents={store.events(run.id)} />
    </div>
  );
}
