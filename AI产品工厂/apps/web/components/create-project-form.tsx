"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ApiResponse = { project?: { id: string }; error?: string };

const productTypes = ["通用产品", "Web 应用", "小游戏", "内容工具"] as const;

export function CreateProjectForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [productType, setProductType] = useState<(typeof productTypes)[number]>("通用产品");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const requirement = String(form.get("prd") ?? "").trim();
    const firstLine = requirement.split("\n")[0]?.replace(/^[#*\-\s]+/, "").trim() ?? "";
    const generatedName = firstLine.length >= 2 ? firstLine.slice(0, 30) : `${productType}项目`;

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: generatedName,
          description: productType,
          workspacePath: null,
          prd: `产品类型：${productType}\n\n${requirement}`
        })
      });
      const result = (await response.json()) as ApiResponse;
      if (!response.ok || !result.project) throw new Error(result.error || "创建产品项目失败");
      router.push(`/projects/${result.project.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建产品项目失败");
      setSubmitting(false);
    }
  }

  return (
    <form className={`intake-composer${compact ? " intake-composer-compact" : ""}`} onSubmit={submit}>
      <div className="product-type-tabs" role="tablist" aria-label="产品类型">
        {productTypes.map((type) => (
          <button
            type="button"
            role="tab"
            aria-selected={productType === type}
            className={productType === type ? "active" : ""}
            onClick={() => setProductType(type)}
            key={type}
          >
            {type}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor={compact ? "prd-home" : "prd"}>描述产品需求</label>
      <textarea
        id={compact ? "prd-home" : "prd"}
        name="prd"
        required
        minLength={20}
        placeholder="描述你想做的产品、目标用户、核心功能和完成标准…"
      />
      {error ? <p className="form-error">{error}</p> : null}
      <div className="composer-actions">
        {!compact ? (
          <Link href="/" className="secondary-button">
            返回
          </Link>
        ) : <span>填写需求后创建产品档案</span>}
        <button className="composer-submit" type="submit" disabled={submitting} aria-label="创建产品">
          {submitting ? "…" : "↑"}
        </button>
      </div>
    </form>
  );
}
