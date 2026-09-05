"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { logout, waitForRuntimeCommand } from "@/features/auth/api";

export function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="sidebar-logout"
      aria-label={submitting ? "正在退出" : failed ? "退出失败，重试" : "退出登录"}
      title={failed ? "退出失败，重试" : "退出登录"}
      disabled={submitting}
      onClick={async () => {
        setSubmitting(true);
        setFailed(false);
        try {
          await waitForRuntimeCommand(await logout());
          router.replace("/login");
          router.refresh();
        } catch {
          setFailed(true);
          setSubmitting(false);
        }
      }}
    >
      <LogOut aria-hidden="true" />
      <span>{submitting ? "退出中…" : failed ? "退出失败，重试" : "退出"}</span>
    </button>
  );
}
