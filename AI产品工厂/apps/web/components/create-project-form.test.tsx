// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateProjectForm } from "./create-project-form";

const { push, refresh, createProject, startProductionRun } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  createProject: vi.fn(),
  startProductionRun: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/features/product-intake/api", () => ({ createProject }));
vi.mock("@/features/production-run/api", () => ({ startProductionRun }));

describe("CreateProjectForm", () => {
  afterEach(cleanup);

  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    createProject.mockReset();
    startProductionRun.mockReset();
  });

  it.each([false, true])("keeps input modes below the field without a back link (compact: %s)", (compact) => {
    render(<CreateProjectForm compact={compact} />);
    const input = screen.getByLabelText("描述产品需求");
    const modes = screen.getByRole("group", { name: "输入方式" });
    const submit = screen.getByRole("button", { name: "发送并开始分析" });

    expect(screen.queryByRole("link", { name: "返回" })).not.toBeInTheDocument();
    expect(input.compareDocumentPosition(modes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(modes.parentElement).toBe(submit.parentElement);
    expect(submit).toBeDisabled();
  });

  it("preserves the draft when switching input modes", async () => {
    const user = userEvent.setup();
    render(<CreateProjectForm />);
    const input = screen.getByLabelText("描述产品需求");
    await user.type(input, "我的产品需求草稿");
    await user.click(screen.getByRole("button", { name: "粘贴 PRD" }));

    expect(input).toHaveValue("我的产品需求草稿");
    expect(input).toHaveAttribute("placeholder", "把已有 PRD 文档内容粘贴到这里…");
    expect(screen.getByRole("button", { name: "粘贴 PRD" })).toHaveAttribute("aria-pressed", "true");
    expect(createProject).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "描述需求" }));
    expect(input).toHaveValue("我的产品需求草稿");
    expect(screen.getByRole("button", { name: "描述需求" })).toHaveAttribute("aria-pressed", "true");
  });

  it("prevents duplicate creation while a valid requirement is submitting", async () => {
    const user = userEvent.setup();
    createProject.mockReturnValue(new Promise(() => undefined));
    render(<CreateProjectForm />);

    await user.type(
      screen.getByLabelText("描述产品需求"),
      "做一个帮助用户整理长文并导出摘要的 Web 产品，需要保存历史记录。"
    );
    const button = screen.getByRole("button", { name: "发送并开始分析" });
    await user.click(button);
    await user.click(button);

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("uses native field validation for requirements shorter than 20 characters", async () => {
    const user = userEvent.setup();
    render(<CreateProjectForm />);
    const input = screen.getByLabelText("描述产品需求");
    await user.type(input, "需求太短");
    await user.click(screen.getByRole("button", { name: "发送并开始分析" }));

    expect(input).toHaveAttribute("minlength", "20");
    expect(createProject).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("请至少填写 20 个字符");
  });

  it("starts analysis immediately after creating the product", async () => {
    const user = userEvent.setup();
    createProject.mockResolvedValue({ project: { id: "project-1" } });
    startProductionRun.mockResolvedValue({ run: { id: "run-1" } });
    render(<CreateProjectForm compact />);

    await user.type(
      screen.getByLabelText("描述产品需求"),
      "做一个帮助用户整理浏览器收藏网址的插件，并且支持搜索和分类。"
    );
    await user.click(screen.getByRole("button", { name: "发送并开始分析" }));

    await waitFor(() => expect(startProductionRun).toHaveBeenCalledWith("project-1"));
    expect(push).toHaveBeenCalledWith("/runs/run-1");
  });
});
