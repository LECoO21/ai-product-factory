import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { getProductFactory } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";
import { hasConfirmableAgentResult } from "@factory/shared";
import { CancelRunButton } from "@/components/cancel-run-button";
import { CreateProjectForm } from "@/components/create-project-form";
import { BrandMark } from "@/components/brand-mark";
import { runStatusLabels, stageLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const projects = getProductFactory().listProjects();
  const runStore = new SqliteProductionRunStore();
  const runs = projects
    .flatMap((project) =>
      runStore.listForProject(project.id).map((run) => ({ run, project }))
    )
    .sort((left, right) => right.run.updatedAt.localeCompare(left.run.updatedAt));
  const runsWithAction = runs.map((entry) => {
    const events = runStore.events(entry.run.id);
    return {
      ...entry,
      needsApproval:
      (entry.run.stage === "intake" || entry.run.stage === "adaptation") &&
      (entry.run.status === "waiting_approval" || entry.run.status === "succeeded") &&
      hasConfirmableAgentResult(events) &&
      !events.some((event) => event.type === "gate.approved")
    };
  });
  const attentionRun =
    runsWithAction.find(({ needsApproval }) => needsApproval) ??
    runsWithAction.find(({ run }) => run.status === "running" || run.status === "ready");

  return (
    <div className="page factory-home">
      <header className="factory-home-header">
        <div className="home-brand-orb" aria-hidden="true"><BrandMark /></div>
        <h1>今天想做什么产品？</h1>
      </header>

      <CreateProjectForm compact />

      {attentionRun ? (
        <section className="attention-card" id="attention">
          <div>
            <span><Clock3 aria-hidden="true" />{attentionRun.needsApproval ? "等你确认" : runStatusLabels[attentionRun.run.status]}</span>
            <h2>{attentionRun.project.name}</h2>
            <strong>{stageLabels[attentionRun.run.stage]}</strong>
          </div>
          <div className="attention-actions">
            <CancelRunButton runId={attentionRun.run.id} />
            <Link href={`/runs/${attentionRun.run.id}`} className="primary-button">
              {attentionRun.needsApproval ? "去确认" : "查看进度"}
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </div>
        </section>
      ) : null}

    </div>
  );
}
