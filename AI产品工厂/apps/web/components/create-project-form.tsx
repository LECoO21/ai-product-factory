"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createProject } from "@/features/product-intake/api";
import { startProductionRun } from "@/features/production-run/api";
import { getErrorMessage } from "@/lib/api/client";

const inputModes = ["描述需求", "粘贴 PRD"] as const;

export function CreateProjectForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [inputMode, setInputMode] = useState<(typeof inputModes)[number]>("描述需求");
  const [requirement, setRequirement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const submittedRequirement = String(form.get("prd") ?? "").trim();
    if (submittedRequirement.length < 20) {
      setError("请至少填写 20 个字符，说明目标用户、核心功能或完成标准。");
      return;
    }
    setSubmitting(true);
    const firstLine = submittedRequirement.split("\n")[0]?.replace(/^[#*\-\s]+/, "").trim() ?? "";
    const generatedName = firstLine.length >= 2 ? firstLine.slice(0, 30) : "新产品";

    try {
      const result = await createProject({
        name: generatedName,
        description: inputMode,
        workspacePath: null,
        prd: submittedRequirement
      });
      const started = await startProductionRun(result.project.id);
      router.push(`/runs/${started.run.id}`);
    } catch (caught) {
      setError(getErrorMessage(caught, "创建产品或启动分析失败"));
      setSubmitting(false);
    }
  }

  return (
    <form className={`intake-composer${compact ? " intake-composer-compact" : ""}`} onSubmit={submit} noValidate>
      <div className="product-type-tabs" role="tablist" aria-label="输入方式">
        {inputModes.map((mode) => (
          <button
            type="button"
            role="tab"
            aria-selected={inputMode === mode}
            className={inputMode === mode ? "active" : ""}
            onClick={() => setInputMode(mode)}
            key={mode}
          >
            {mode}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor={compact ? "prd-home" : "prd"}>描述产品需求</label>
      <textarea
        id={compact ? "prd-home" : "prd"}
        name="prd"
        value={requirement}
        onChange={(event) => setRequirement(event.target.value)}
        required
        minLength={20}
        placeholder={inputMode === "描述需求"
          ? "描述你想做的产品、目标用户、核心功能和完成标准…"
          : "把已有 PRD 文档内容粘贴到这里…"}
        aria-describedby={error ? (compact ? "prd-home-error" : "prd-error") : undefined}
      />
      {error ? <p id={compact ? "prd-home-error" : "prd-error"} className="form-error" role="alert">{error}</p> : null}
      <div className="composer-actions">
        {!compact ? (
          <Link href="/" className="secondary-button">
            返回
          </Link>
        ) : <span>发送后立即开始分析</span>}
        <button className="composer-submit" type="submit" disabled={submitting || !requirement.trim()} aria-label="发送并开始分析" aria-busy={submitting}>
          {submitting ? "…" : "↑"}
        </button>
      </div>
    </form>
  );
}
