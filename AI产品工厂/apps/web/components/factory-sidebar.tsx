"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ProjectSummary } from "@factory/shared";
import { BrandMark } from "@/components/brand-mark";
import { statusLabels } from "@/lib/labels";

export function FactorySidebar({ projects }: { projects: ProjectSummary[] }) {
  const pathname = usePathname();

  return (
    <aside className="factory-sidebar" aria-label="产品工厂导航">
      <div className="sidebar-brand-row">
        <Link href="/" className="brand" aria-label="返回 Naxe 首页">
          <BrandMark />
          <strong>Naxe</strong>
        </Link>
        <span>AI 产品工厂</span>
      </div>

      <nav className="sidebar-nav" aria-label="主要功能">
        <Link
          href="/projects/new"
          className={pathname === "/projects/new" ? "active" : ""}
        >
          <span aria-hidden="true">＋</span>
          新建产品
        </Link>
        <Link href="/#projects" className={pathname === "/" ? "active" : ""}>
          <span aria-hidden="true">▦</span>
          产品
        </Link>
      </nav>

      <section className="sidebar-history" aria-labelledby="sidebar-history-title">
        <div className="sidebar-section-head">
          <span id="sidebar-history-title">最近产品</span>
          <Link href="/#projects">全部</Link>
        </div>
        <div className="sidebar-project-list">
          {projects.slice(0, 8).map((project) => (
            <Link
              href={`/projects/${project.id}`}
              className={pathname === `/projects/${project.id}` ? "active" : ""}
              key={project.id}
            >
              <strong>{project.name}</strong>
              <span>{statusLabels[project.status]}</span>
            </Link>
          ))}
          {projects.length === 0 ? <span className="sidebar-empty">还没有产品</span> : null}
        </div>
      </section>

      <div className="sidebar-foot">
        <span aria-hidden="true" />
        本地生产模式
      </div>
    </aside>
  );
}
