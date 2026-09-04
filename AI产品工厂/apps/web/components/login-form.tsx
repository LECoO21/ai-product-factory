"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  cancelLogin,
  chatGptLoginResultSchema,
  getAccount,
  startLogin,
  waitForRuntimeCommand
} from "@/features/auth/api";
import { getErrorMessage } from "@/lib/api/client";

type LoginPhase =
  | "idle"
  | "starting"
  | "awaiting_auth"
  | "cancelling"
  | "cancelled"
  | "success"
  | "failed";

const LOGIN_COMPLETION_TIMEOUT_MS = 5 * 60_000;
const CLOSED_POPUP_GRACE_MS = 5_000;

const phaseMessage: Record<LoginPhase, string> = {
  idle: "",
  starting: "正在连接 Codex 登录服务…",
  awaiting_auth: "请在打开的 OpenAI 页面完成登录。",
  cancelling: "正在取消登录…",
  cancelled: "登录已取消，你可以重新开始。",
  success: "登录成功，正在进入产品工厂…",
  failed: ""
};

const pause = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const aborted = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("操作已取消", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
  });

const isOfficialLoginUrl = (value: string) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && ["openai.com", "chatgpt.com"].some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
};

export function LoginForm({ nextPath = "/" }: { nextPath?: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<LoginPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [officialLoginUrl, setOfficialLoginUrl] = useState<string | null>(null);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    popupRef.current?.close();
  }, []);

  const active = ["starting", "awaiting_auth", "cancelling", "success"].includes(phase);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active) return;

    abortRef.current?.abort();
    popupRef.current?.close();
    const controller = new AbortController();
    abortRef.current = controller;
    const popup = window.open(
      "about:blank",
      "naxe-openai-login",
      "popup,width=520,height=720"
    );
    if (popup) {
      try {
        popup.opener = null;
      } catch {
        // Some browsers expose opener as read-only. The final link also uses noreferrer.
      }
    }
    popupRef.current = popup;
    setPopupBlocked(!popup);
    setPhase("starting");
    setError(null);
    setOfficialLoginUrl(null);
    setLoginId(null);

    try {
      const command = await waitForRuntimeCommand(
        await startLogin(controller.signal),
        { signal: controller.signal }
      );
      const parsed = chatGptLoginResultSchema.safeParse(command.result);
      if (!parsed.success || !isOfficialLoginUrl(parsed.data.authUrl)) {
        throw new Error("Codex 没有返回有效的 OpenAI 登录地址，请重试。");
      }

      setLoginId(parsed.data.loginId);
      setOfficialLoginUrl(parsed.data.authUrl);
      let loginWindow = popupRef.current;
      try {
        if (loginWindow && !loginWindow.closed) {
          loginWindow.location.replace(parsed.data.authUrl);
        } else {
          loginWindow = window.open(parsed.data.authUrl, "naxe-openai-login");
        }
      } catch {
        loginWindow = null;
      }
      popupRef.current = loginWindow;
      setPopupBlocked(!loginWindow);
      setPhase("awaiting_auth");

      const deadline = Date.now() + LOGIN_COMPLETION_TIMEOUT_MS;
      let popupClosedAt: number | null = null;
      while (!controller.signal.aborted) {
        const account = await getAccount(controller.signal);
        if (account.authenticated && account.accountType === "chatgpt") {
          setPhase("success");
          popupRef.current?.close();
          const destination = nextPath.startsWith("/") && !nextPath.startsWith("//")
            ? nextPath
            : "/";
          router.replace(destination);
          router.refresh();
          return;
        }
        if (Date.now() >= deadline) {
          throw new Error("登录等待超时，请重新开始。");
        }
        if (popupRef.current?.closed) {
          popupClosedAt ??= Date.now();
          if (Date.now() - popupClosedAt >= CLOSED_POPUP_GRACE_MS) {
            throw new Error("登录窗口已关闭，请重新开始。");
          }
        }
        await pause(1_200, controller.signal);
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      popupRef.current?.close();
      popupRef.current = null;
      setPhase("failed");
      setError(getErrorMessage(caught, "登录失败"));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function cancel() {
    if (!loginId || phase !== "awaiting_auth") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("cancelling");
    setError(null);
    try {
      const command = await cancelLogin(loginId, controller.signal);
      await waitForRuntimeCommand(command, {
        signal: controller.signal,
        timeoutMs: 20_000
      });
      popupRef.current?.close();
      popupRef.current = null;
      setOfficialLoginUrl(null);
      setLoginId(null);
      setPopupBlocked(false);
      setPhase("cancelled");
    } catch (caught) {
      if (controller.signal.aborted) return;
      setPhase("failed");
      setError(getErrorMessage(caught, "取消登录失败，请重试。"));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  return (
    <form className="login-form" onSubmit={submit} noValidate>
      {phaseMessage[phase] ? (
        <p className="login-status" role="status" aria-live="polite">
          {phaseMessage[phase]}
        </p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {officialLoginUrl ? (
        <a
          className="official-login-link"
          href={officialLoginUrl}
          target="_blank"
          rel="noreferrer"
        >
          {popupBlocked ? "打开 OpenAI 登录页面" : "没有看到登录页面？重新打开"}
        </a>
      ) : null}
      <div className="login-actions">
        <button className="primary-button" type="submit" disabled={active}>
          {phase === "starting" ? "正在连接…" : phase === "awaiting_auth" ? "等待登录完成…" : "使用 OpenAI 账户登录"}
        </button>
        {phase === "awaiting_auth" && loginId ? (
          <button className="secondary-button" type="button" onClick={cancel}>
            取消
          </button>
        ) : null}
      </div>
      <p className="login-privacy">登录凭证只由 Codex 管理，本网站不会读取或保存。</p>
    </form>
  );
}
