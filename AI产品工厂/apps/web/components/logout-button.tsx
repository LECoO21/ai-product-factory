"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { logout } from "@/features/auth/api";

export function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  return (
    <button
      type="button"
      className="sidebar-logout"
      disabled={submitting}
      onClick={async () => {
        setSubmitting(true);
        await logout().catch(() => null);
        router.replace("/login");
        router.refresh();
      }}
    >
      {submitting ? "退出中…" : "退出"}
    </button>
  );
}
