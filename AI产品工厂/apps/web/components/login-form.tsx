"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { login } from "@/features/auth/api";
import { getErrorMessage } from "@/lib/api/client";

export function LoginForm({ nextPath = "/" }: { nextPath?: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const inviteCode = String(new FormData(event.currentTarget).get("inviteCode") ?? "").trim();
    try {
      await login(inviteCode);
      router.replace(nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/");
      router.refresh();
    } catch (caught) {
      setError(getErrorMessage(caught, "登录失败"));
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <label htmlFor="invite-code">邀请码</label>
      <input id="invite-code" name="inviteCode" type="password" autoComplete="one-time-code" required autoFocus />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? "正在登录…" : "进入产品工厂"}
      </button>
    </form>
  );
}
