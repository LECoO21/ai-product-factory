// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

const {
  replace,
  refresh,
  startLogin,
  waitForRuntimeCommand,
  getAccount,
  cancelLogin
} = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  startLogin: vi.fn(),
  waitForRuntimeCommand: vi.fn(),
  getAccount: vi.fn(),
  cancelLogin: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh })
}));

vi.mock("@/features/auth/api", async () => {
  const { z } = await import("zod");
  return {
    chatGptLoginResultSchema: z.object({
      loginId: z.string().min(1),
      authUrl: z.string().url()
    }),
    startLogin,
    waitForRuntimeCommand,
    getAccount,
    cancelLogin
  };
});

const pendingCommand = {
  id: "command-1",
  type: "account.login.start",
  status: "pending",
  result: null,
  error: null,
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  completedAt: null
};

const completedLoginCommand = {
  ...pendingCommand,
  status: "completed",
  result: {
    loginId: "login-1",
    authUrl: "https://auth.openai.com/codex/login"
  },
  completedAt: "2026-09-02T00:00:01.000Z"
};

describe("LoginForm", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
    startLogin.mockReset();
    waitForRuntimeCommand.mockReset();
    getAccount.mockReset();
    cancelLogin.mockReset();
    startLogin.mockResolvedValue(pendingCommand);
    waitForRuntimeCommand.mockResolvedValue(completedLoginCommand);
  });

  it("opens the official login page and enters the requested page after authentication", async () => {
    const user = userEvent.setup();
    const popup = {
      closed: false,
      opener: window,
      location: { replace: vi.fn() },
      close: vi.fn()
    };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    getAccount.mockResolvedValue({ authenticated: true, accountType: "chatgpt" });
    render(<LoginForm nextPath="/projects/project-1" />);

    await user.click(screen.getByRole("button", { name: "使用 OpenAI 账户登录" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/projects/project-1"));
    expect(startLogin).toHaveBeenCalledTimes(1);
    expect(popup.location.replace).toHaveBeenCalledWith(
      "https://auth.openai.com/codex/login"
    );
    expect(popup.close).toHaveBeenCalled();
  });

  it("shows a manual official link when the browser blocks the popup", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "open").mockReturnValue(null);
    getAccount.mockReturnValue(new Promise(() => undefined));
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "使用 OpenAI 账户登录" }));

    const link = await screen.findByRole("link", { name: "打开 OpenAI 登录页面" });
    expect(link).toHaveAttribute("href", "https://auth.openai.com/codex/login");
  });

  it("cancels an active Codex login", async () => {
    const user = userEvent.setup();
    const popup = {
      closed: false,
      opener: window,
      location: { replace: vi.fn() },
      close: vi.fn()
    };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    getAccount.mockImplementation((signal?: AbortSignal) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const cancelledCommand = {
      ...pendingCommand,
      id: "command-2",
      type: "account.login.cancel",
      status: "completed"
    };
    cancelLogin.mockResolvedValue(cancelledCommand);
    waitForRuntimeCommand
      .mockResolvedValueOnce(completedLoginCommand)
      .mockResolvedValueOnce(cancelledCommand);
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "使用 OpenAI 账户登录" }));
    await user.click(await screen.findByRole("button", { name: "取消" }));

    await screen.findByText("登录已取消，你可以重新开始。");
    expect(cancelLogin).toHaveBeenCalledWith("login-1", expect.any(AbortSignal));
    expect(popup.close).toHaveBeenCalled();
  });
});
