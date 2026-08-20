import Link from "next/link";
import type { ProjectSummary } from "@factory/shared";
import { capabilityLabels, formatDate, statusLabels } from "@/lib/labels";

export function ProjectCard({ project, index }: { project: ProjectSummary; index: number }) {
  return (
    <Link href={`/projects/${project.id}`} className="project-card">
      <div className="card-top">
        <span className="status-pill">{statusLabels[project.status]}</span>
        <span className="card-number">#{String(index + 1).padStart(2, "0")}</span>
      </div>
      <h3>{project.name}</h3>
      <p>{project.description || "已生成初始产品画像，等待确认产品范围。"}</p>
      <div className="pack-list">
        {project.blueprint.capabilityPacks.slice(0, 4).map((pack) => (
          <span className="pack-pill" key={pack}>
            {capabilityLabels[pack]}
          </span>
        ))}
        <span className="pack-pill">更新于 {formatDate(project.updatedAt)}</span>
      </div>
    </Link>
  );
}
