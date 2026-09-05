"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { z } from "zod";
import { getErrorMessage, requestJson } from "@/lib/api/client";

export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteProject() {
    if (pending.current) return;
    pending.current = true;
    setDeleting(true);
    setError(null);
    try {
      await requestJson(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
        schema: z.object({ deleted: z.literal(true) })
      });
      dialog.current?.close();
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(getErrorMessage(caught, "删除失败，请重试"));
    } finally {
      pending.current = false;
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="danger-button"
        onClick={() => {
          setError(null);
          dialog.current?.showModal();
          cancelButton.current?.focus();
        }}
      >
        <Trash2 aria-hidden="true" />删除产品
      </button>
      <dialog
        ref={dialog}
        className="delete-project-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={deleting}
        onCancel={(event) => { if (pending.current) event.preventDefault(); }}
      >
        <h2 id={titleId}>删除产品？</h2>
        <div id={descriptionId}>
          <p>“{projectName}”及其对话、运行记录将从产品列表和历史记录中移除。</p>
          <p>本地代码和生成文件不会删除。待执行任务会取消；正在运行的流程需要先终止。</p>
        </div>
        {error ? <p className="delete-project-error" role="alert">{error}</p> : null}
        <div className="delete-project-dialog-actions">
          <button ref={cancelButton} type="button" className="secondary-button" disabled={deleting} onClick={() => dialog.current?.close()}>
            取消
          </button>
          <button type="button" className="danger-button" disabled={deleting} onClick={() => void deleteProject()}>
            {deleting ? "删除中…" : "确认删除"}
          </button>
        </div>
      </dialog>
    </>
  );
}
