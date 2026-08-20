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
          description: form.get("description"),
          workspacePath: String(form.get("workspacePath") || "").trim() || null,
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
      <div className="field-grid">
        <div className="field">
          <label htmlFor="name">项目名称</label>
          <input id="name" name="name" required minLength={2} placeholder="例如：内容生产工作台" />
        </div>
        <div className="field">
          <label htmlFor="workspacePath">本地工作区</label>
          <input id="workspacePath" name="workspacePath" placeholder="可稍后绑定绝对路径" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="description">一句话说明</label>
        <input
          id="description"
          name="description"
          maxLength={500}
          placeholder="谁在什么场景下，用它完成什么任务？"
        />
      </div>
      <div className="field">
        <label htmlFor="prd">PRD 或产品说明</label>
        <textarea
          id="prd"
          name="prd"
          required
          minLength={20}
          placeholder="粘贴完整 PRD。工厂会先提取产品画像，再组合本项目需要的生产蓝图和质量闸门。"
        />
        <small>当前先用确定性规则生成画像；创建后可启动 Pi Agent + DeepSeek 体检批次继续分析。</small>
      </div>
      <div className="form-actions">
        <div>{error ? <p className="form-error">{error}</p> : null}</div>
        <div className="card-top">
          <Link href="/" className="secondary-button">
            返回项目列表
          </Link>
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "正在编译蓝图…" : "创建并分析产品"}
          </button>
        </div>
      </div>
    </form>
  );
}
