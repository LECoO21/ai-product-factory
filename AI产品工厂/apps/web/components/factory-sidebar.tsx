"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ProjectSummary } from "@factory/shared";
import { BrandMark } from "@/components/brand-mark";
import { statusLabels } from "@/lib/labels";
import { LogoutButton } from "@/components/logout-button";

export function FactorySidebar({ projects }: { projects: ProjectSummary[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <button
        className="mobile-menu-trigger"
        type="button"
        aria-label="打开导航"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
      >
        <span aria-hidden="true">☰</span>
        Naxe
      </button>
      <button
        className={`sidebar-overlay${mobileOpen ? " is-visible" : ""}`}
        type="button"
        aria-label="关闭导航"
        tabIndex={mobileOpen ? 0 : -1}
        onClick={() => setMobileOpen(false)}
      />
      <aside
        className={`factory-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-mobile-open" : ""}`}
        aria-label="产品工厂导航"
      >
      <div className="sidebar-brand-row">
        <Link href="/" className="brand" aria-label="返回 Naxe 首页" onClick={() => setMobileOpen(false)}>
          <BrandMark />
          <strong>Naxe</strong>
        </Link>
        <button
          className="sidebar-collapse-toggle"
          type="button"
          aria-label={mobileOpen ? "关闭导航" : collapsed ? "展开导航" : "收起导航"}
          aria-expanded={!collapsed}
          onClick={() => mobileOpen ? setMobileOpen(false) : setCollapsed((current) => !current)}
        >
          <span aria-hidden="true">{mobileOpen ? "×" : collapsed ? "›" : "‹"}</span>
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="主要功能">
        <Link
          href="/projects/new"
          className={pathname === "/projects/new" ? "active" : ""}
          aria-label="新建产品"
          onClick={() => setMobileOpen(false)}
        >
          <span aria-hidden="true">＋</span>
          <span className="sidebar-label">新建产品</span>
        </Link>
        <Link
          href="/#projects"
          className={pathname === "/" ? "active" : ""}
          aria-label="产品"
          onClick={() => setMobileOpen(false)}
        >
          <span aria-hidden="true">▦</span>
          <span className="sidebar-label">产品</span>
        </Link>
      </nav>

      <div className="mobile-logout">
        <LogoutButton />
      </div>

      <section className="sidebar-history" aria-labelledby="sidebar-history-title">
        <div className="sidebar-section-head">
          <span id="sidebar-history-title">最近产品</span>
          <Link href="/#projects">全部</Link>
        </div>
        <div className="sidebar-project-list">
          {projects.slice(0, 20).map((project) => (
            <Link
              href={`/projects/${project.id}`}
              className={pathname === `/projects/${project.id}` ? "active" : ""}
              key={project.id}
              onClick={() => setMobileOpen(false)}
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
        <span>生产工作台</span>
        <LogoutButton />
      </div>
      </aside>
    </>
  );
}
