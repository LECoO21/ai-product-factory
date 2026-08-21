import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductFactory } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";
import { StartRunButton } from "@/components/start-run-button";
import { runStatusLabels, stageLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProductFactory().getProject(id);
  if (!project) notFound();
  const runStore = new SqliteProductionRunStore();
  const recentRuns = runStore.listForProject(project.id);
  const latestRun = recentRuns[0];
  const latestRunNeedsApproval = latestRun
    ? (latestRun.stage === "intake" || latestRun.stage === "adaptation") &&
      (latestRun.status === "waiting_approval" || latestRun.status === "succeeded") &&
      !runStore.events(latestRun.id).some((event) => event.type === "gate.approved")
    : false;

  return (
    <div className="page simple-page">
      <header className="simple-project-header">
        <Link href="/" className="back-link">← 返回</Link>
        <h1>{project.name}</h1>
        {latestRun ? (
          <Link href={`/runs/${latestRun.id}`} className="primary-button">
            {latestRunNeedsApproval ? "去确认" : "继续"}
          </Link>
        ) : (
          <StartRunButton projectId={project.id} />
        )}
      </header>

      {recentRuns.length > 0 ? (
        <section className="simple-run-list">
          {recentRuns.slice(0, 20).map((run) => (
            <Link href={`/runs/${run.id}`} key={run.id}>
              <strong>{stageLabels[run.stage]}</strong>
              <span>{runStatusLabels[run.status]}</span>
            </Link>
          ))}
        </section>
      ) : null}

      <details className="prd-details">
        <summary>查看 PRD</summary>
        <pre className="prd-text">{project.prd}</pre>
      </details>
    </div>
  );
}
