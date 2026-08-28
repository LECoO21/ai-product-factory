// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateProjectForm } from "./create-project-form";

const { push, refresh, createProject } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  createProject: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/features/product-intake/api", () => ({ createProject }));

describe("CreateProjectForm", () => {
  afterEach(cleanup);

  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    createProject.mockReset();
  });

  it("prevents duplicate creation while a valid requirement is submitting", async () => {
    const user = userEvent.setup();
    createProject.mockReturnValue(new Promise(() => undefined));
    render(<CreateProjectForm />);

    await user.type(
      screen.getByLabelText("描述产品需求"),
      "做一个帮助用户整理长文并导出摘要的 Web 产品，需要保存历史记录。"
    );
    const button = screen.getByRole("button", { name: "创建产品" });
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
    await user.click(screen.getByRole("button", { name: "创建产品" }));

    expect(input).toHaveAttribute("minlength", "20");
    expect(createProject).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("请至少填写 20 个字符");
  });
});
