"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ApiResponse = { project?: { id: string }; error?: string };

export function CreateProjectForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          description: "",
          workspacePath: null,
          prd: form.get("prd")
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
    <form className="form-card" onSubmit={submit}>
      <div className="field">
        <label htmlFor="name">产品名称</label>
        <input id="name" name="name" required minLength={2} />
      </div>
      <div className="field">
        <label htmlFor="prd">PRD</label>
        <textarea id="prd" name="prd" required minLength={20} />
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="form-actions">
        <Link href="/" className="secondary-button">
          返回
        </Link>
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "正在创建…" : "创建产品"}
        </button>
      </div>
    </form>
  );
}
