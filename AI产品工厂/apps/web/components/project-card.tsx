import Link from "next/link";
import type { ProjectSummary } from "@factory/shared";
import { statusLabels } from "@/lib/labels";

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link href={`/projects/${project.id}`} className="project-card">
      <div className="card-top">
        <span className="status-pill">{statusLabels[project.status]}</span>
      </div>
      <h3>{project.name}</h3>
      <span className="project-card-action">打开产品</span>
    </Link>
  );
}
