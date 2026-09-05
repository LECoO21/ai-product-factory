// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteProjectButton } from "./delete-project-button";

const { replace, refresh, requestJson } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), requestJson: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/lib/api/client", async (original) => ({ ...await original<object>(), requestJson }));

beforeEach(() => {
  vi.resetAllMocks();
  // jsdom does not implement native dialog methods; real browser coverage is in E2E.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

describe("DeleteProjectButton", () => {
  it("requires confirmation, identifies the product and focuses cancel by default", async () => {
    const user = userEvent.setup();
    render(<DeleteProjectButton projectId="product-1" projectName="我的测试产品" />);
    await user.click(screen.getByRole("button", { name: "删除产品" }));
    expect(screen.getByRole("dialog", { name: "删除产品？" })).toBeVisible();
    expect(screen.getByText(/我的测试产品/)).toBeVisible();
    expect(screen.getByText(/本地代码和生成文件不会删除/)).toBeVisible();
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    expect(requestJson).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("submits once, locks the dialog while pending and refreshes the sidebar on success", async () => {
    const user = userEvent.setup();
    let complete!: (value: { deleted: true }) => void;
    requestJson.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    render(<DeleteProjectButton projectId="product-1" projectName="我的测试产品" />);
    await user.click(screen.getByRole("button", { name: "删除产品" }));
    await user.dblClick(screen.getByRole("button", { name: "确认删除" }));
    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(requestJson).toHaveBeenCalledWith("/api/projects/product-1", expect.objectContaining({ method: "DELETE" }));
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除中…" })).toBeDisabled();
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(screen.getByRole("dialog"), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    complete({ deleted: true });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open with the server error and allows retry", async () => {
    const user = userEvent.setup();
    requestJson.mockRejectedValueOnce(new Error("任务正在运行，请先终止流程"));
    render(<DeleteProjectButton projectId="product-1" projectName="我的测试产品" />);
    await user.click(screen.getByRole("button", { name: "删除产品" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("任务正在运行，请先终止流程");
    expect(screen.getByRole("button", { name: "确认删除" })).toBeEnabled();
    expect(replace).not.toHaveBeenCalled();
    requestJson.mockResolvedValueOnce({ deleted: true });
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
