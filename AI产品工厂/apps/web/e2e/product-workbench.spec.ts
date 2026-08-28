import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

type Fixtures = { confirmableRunId: string; failedRunId: string };

const fixtures = (): Fixtures => {
  const dataDir = process.env.FACTORY_E2E_DATA_DIR;
  if (!dataDir) throw new Error("E2E data directory was not configured");
  return JSON.parse(readFileSync(join(dataDir, "fixtures.json"), "utf8")) as Fixtures;
};

const collectPageErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      errors.push(message.text());
    }
  });
  return errors;
};

test("creates one product, starts one run, and restores it after refresh", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/projects/new");
  const requirement = page.getByLabel("描述产品需求");

  await requirement.fill("需求太短");
  await page.getByRole("button", { name: "创建产品" }).click();
  await expect(page.getByText("请至少填写 20 个字符", { exact: false })).toBeVisible();

  const projectName = "E2E 键盘创建的通用产品";
  await requirement.fill(`${projectName}\n帮助用户整理长文、保存历史结果并导出结构化摘要。`);
  await requirement.press("Tab");
  await page.keyboard.press("Tab");
  const createButton = page.getByRole("button", { name: "创建产品" });
  await expect(createButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

  const projectsResponse = await page.request.get("/api/projects");
  const projects = await projectsResponse.json() as { projects: Array<{ name: string }> };
  expect(projects.projects.filter((project) => project.name === projectName)).toHaveLength(1);

  await page.getByRole("button", { name: "开始分析" }).click();
  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);
  await expect(page.getByText("等待开始", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "理解产品" })).toBeVisible();
  await expect(page.getByText("等待开始", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("shows the real result before confirmation and keeps details collapsed", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(`/runs/${fixtures().confirmableRunId}`);

  const result = page.getByRole("heading", { name: "这一步的结果" });
  const confirmation = page.getByRole("button", { name: "确认理解，进入技术方案" });
  await expect(result).toBeVisible();
  await expect(page.getByText("产品面向单人产品负责人", { exact: false })).toBeVisible();
  await expect(confirmation).toBeVisible();
  expect(await result.evaluate((node) => {
    const confirmationTitle = document.querySelector("#confirmation-title");
    return Boolean(
      confirmationTitle &&
      (node.compareDocumentPosition(confirmationTitle) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  })).toBe(true);
  await expect(page.getByText("本阶段不会部署或发布。", { exact: false })).toBeVisible();

  const details = page.locator("details.run-log-details");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  expect(errors).toEqual([]);
});

test("preserves failed output without showing a confirmation action", async ({ page }) => {
  await page.goto(`/runs/${fixtures().failedRunId}`);
  await expect(page.getByText("处理失败", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("已有的部分分析结果", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新分析" })).toBeVisible();
  await expect(page.getByText("确认理解，进入技术方案")).toHaveCount(0);
});

test("reads the real run status before reconnecting an interrupted event stream", async ({ page }) => {
  const projectResponse = await page.request.post("/api/projects", {
    data: {
      name: "E2E 断线恢复产品",
      description: "通用产品",
      workspacePath: null,
      prd: "验证运行页在事件连接中断后不会宣称失败，并且能够从后端真实状态恢复连接。"
    }
  });
  const { project } = await projectResponse.json() as { project: { id: string } };
  const runResponse = await page.request.post(`/api/projects/${project.id}/runs`, {
    data: { objective: "验证断线恢复" }
  });
  const { run } = await runResponse.json() as { run: { id: string } };

  await page.route(`**/api/runs/${run.id}/events**`, (route) => route.abort("connectionrefused"));
  await page.goto(`/runs/${run.id}`);
  await expect(page.getByText("正在恢复连接", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("处理失败", { exact: true })).toHaveCount(0);

  await page.unroute(`**/api/runs/${run.id}/events**`);
  await expect(page.getByText("等待开始", { exact: true }).first()).toBeVisible({ timeout: 5_000 });
});

for (const width of [390, 768, 1280, 1440]) {
  test(`keeps core actions visible without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/runs/${fixtures().confirmableRunId}`);
    await expect(page.getByRole("button", { name: "确认理解，进入技术方案" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
