import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

type Fixtures = {
  confirmableRunId: string;
  failedRunId: string;
  secondStageRunId: string;
  revisionSourceRunId: string;
  historyRunId: string;
};

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

test("opens the personal factory directly without login or logout controls", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "今天想做什么产品？" })).toBeVisible();
  await expect(page.getByText("进入 AI 产品工厂")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "退出登录" })).toHaveCount(0);
});

test("creates one product, starts one run, and restores it after refresh", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/projects/new");
  const requirement = page.getByLabel("描述产品需求");

  await requirement.fill("需求太短");
  await page.getByRole("button", { name: "发送并开始分析" }).click();
  await expect(page.getByText("请至少填写 20 个字符", { exact: false })).toBeVisible();

  const projectName = "E2E 键盘创建的通用产品";
  await requirement.fill(`${projectName}\n帮助用户整理长文、保存历史结果并导出结构化摘要。`);
  await requirement.press("Tab");
  await page.keyboard.press("Tab");
  const sendButton = page.getByRole("button", { name: "发送并开始分析" });
  await expect(sendButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

  const projectsResponse = await page.request.get("/api/projects");
  const projects = await projectsResponse.json() as { projects: Array<{ name: string }> };
  expect(projects.projects.filter((project) => project.name === projectName)).toHaveLength(1);

  await expect(page.getByText("等待开始", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
  await expect(page.getByText("等待开始", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("shows the real result before confirmation and keeps details collapsed", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/runs/${fixtures().confirmableRunId}`);

  const confirmation = page.getByRole("button", { name: "确认理解，进入技术方案" });
  const conversation = page.getByRole("main", { name: "对话记录" });
  await expect(conversation.getByRole("heading", { name: "需求分析", level: 3 })).toBeVisible();
  await expect(conversation.getByRole("heading", { name: "PRD 接单体检 | 产品理解摘要" })).toHaveCount(0);
  const result = conversation.getByText("产品面向单人产品负责人", { exact: false });
  await expect(result).toBeVisible();
  await expect(conversation.getByRole("button", { name: "确认理解，进入技术方案" })).toBeVisible();
  await expect(page.locator(".chat-confirmation").getByRole("button", { name: "确认理解，进入技术方案" })).toBeVisible();
  const resultBox = await result.boundingBox();
  const confirmationBox = await confirmation.boundingBox();
  expect(resultBox).not.toBeNull();
  expect(confirmationBox).not.toBeNull();
  expect(resultBox!.y + resultBox!.height).toBeLessThanOrEqual(confirmationBox!.y);
  await expect(page.getByText("本阶段不会部署或发布。", { exact: false })).toBeVisible();

  const details = conversation.locator("details.run-log-details").first();
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await page.reload();
  await expect(conversation.getByRole("heading", { name: "需求分析", level: 3 })).toBeVisible();
  await expect(conversation.getByRole("heading", { name: "PRD 接单体检 | 产品理解摘要" })).toHaveCount(0);
  const snapshotResponse = await page.request.get(`/api/runs/${fixtures().confirmableRunId}`);
  expect(snapshotResponse.ok()).toBe(true);
  const snapshot = await snapshotResponse.json() as { events: Array<{ type: string; payload: { delta?: string } }> };
  const storedOutput = snapshot.events.filter((event) => event.type === "text.delta").map((event) => event.payload.delta ?? "").join("");
  expect(storedOutput).toContain("# PRD 接单体检 | 产品理解摘要");
  await page.screenshot({ path: "/tmp/naxe-plain-result-title.png" });
  expect(errors).toEqual([]);
});

test("submits feedback from the chat composer and preserves the full same-stage conversation after refresh", async ({ page }) => {
  const sourceRunId = fixtures().revisionSourceRunId;
  await page.goto(`/runs/${sourceRunId}`);

  const composer = page.locator(".chat-composer");
  const feedback = composer.getByRole("textbox", { name: "补充回答或修改意见" });
  const requestedChange = "增加导出结构化摘要，并保留上一版结果用于对比。";
  await feedback.fill(requestedChange);
  await composer.getByRole("button", { name: "提交并重新分析" }).click();

  await page.waitForURL((url) =>
    /\/runs\/[a-f0-9-]+$/.test(url.pathname) && !url.pathname.endsWith(sourceRunId)
  );
  await expect(page.getByText("等待开始", { exact: true }).first()).toBeVisible();

  const revisionRunId = page.url().split("/").at(-1);
  const revisionResponse = await page.request.get(`/api/runs/${revisionRunId}`);
  const revision = await revisionResponse.json() as {
    run: { projectId: string; stage: string; objective: string };
  };
  expect(revision.run.stage).toBe("intake");
  expect(revision.run.objective).toContain("增加导出结构化摘要");
  const conversation = page.getByRole("main", { name: "对话记录" });
  await expect(conversation.locator(".chat-message-user").getByText(requestedChange, { exact: true })).toBeVisible();
  await expect(conversation.getByText("这是待产品负责人检查的完整结果", { exact: false })).toBeVisible();
  await expect(conversation.locator(".chat-message-user").getByText("为单人产品负责人提供一个通用 AI 产品需求整理工作台", { exact: false })).toHaveCount(1);
  await expect(conversation.getByRole("button", { name: "确认理解，进入技术方案" })).toHaveCount(0);
  await page.reload();
  await expect(conversation.locator(".chat-message-user").getByText(requestedChange, { exact: true })).toBeVisible();
  await expect(conversation.getByText("这是待产品负责人检查的完整结果", { exact: false })).toBeVisible();
});

test("preserves failed output without showing a confirmation action", async ({ page }) => {
  await page.goto(`/runs/${fixtures().failedRunId}`);
  await expect(page.getByText("处理失败", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("已有的部分分析结果", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新分析" })).toBeVisible();
  await expect(page.getByText("确认理解，进入技术方案")).toHaveCount(0);
});

test("continues under the same product and restores its result and approval as chat messages", async ({ page }) => {
  const sourceRunId = fixtures().secondStageRunId;
  const sourceResponse = await page.request.get(`/api/runs/${sourceRunId}`);
  const source = await sourceResponse.json() as { run: { id: string; projectId: string } };
  await page.goto(`/runs/${sourceRunId}`);

  await page.getByRole("button", { name: "确认理解，进入技术方案" }).click();
  await page.waitForURL((url) =>
    /\/runs\/[a-f0-9-]+$/.test(url.pathname) && !url.pathname.endsWith(sourceRunId)
  );
  await expect(page.getByText("等待开始", { exact: true }).first()).toBeVisible();

  const nextRunId = page.url().split("/").at(-1);
  expect(nextRunId).toBeTruthy();
  expect(nextRunId).not.toBe(source.run.id);
  const nextResponse = await page.request.get(`/api/runs/${nextRunId}`);
  const next = await nextResponse.json() as {
    run: { id: string; projectId: string; stage: string };
  };
  expect(next.run).toMatchObject({ projectId: source.run.projectId, stage: "adaptation" });
  const conversation = page.getByRole("main", { name: "对话记录" });
  await expect(conversation.locator(".chat-message-user").getByText("确认理解，进入技术方案", { exact: true })).toBeVisible();
  await expect(conversation.getByText("产品需求已经理解完成", { exact: false })).toBeVisible();
  await expect(conversation.getByRole("button", { name: "确认理解，进入技术方案" })).toHaveCount(0);
  await page.reload();
  await expect(conversation.locator(".chat-message-user").getByText("确认理解，进入技术方案", { exact: true })).toBeVisible();
  await expect(conversation.getByText("产品需求已经理解完成", { exact: false })).toBeVisible();
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
  test(`scrolls full history while keeping the chat input usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/runs/${fixtures().historyRunId}`);
    const conversation = page.getByRole("main", { name: "对话记录" });
    const composer = page.locator(".chat-composer");
    const input = composer.getByRole("textbox", { name: "补充回答或修改意见" });
    const confirmation = conversation.getByRole("button", { name: "确认方案，生成开发计划" });
    await expect(confirmation).toBeInViewport();
    await expect(input).toBeInViewport();
    const outerFrames = await page.locator(".app-shell, .run-page, .run-header, .run-console").evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
          radius: style.borderRadius,
          shadow: style.boxShadow
        };
      })
    );
    expect(outerFrames).toHaveLength(4);
    for (const frame of outerFrames) {
      expect(frame.borderWidths).toEqual(["0px", "0px", "0px", "0px"]);
      expect(frame.radius).toBe("0px");
      expect(frame.shadow).toBe("none");
    }
    const shell = page.locator(".app-shell");
    await expect(shell).toHaveCSS("max-width", "none");
    await expect(shell).toHaveCSS("padding", "0px");
    await expect(page.locator(".run-page")).toHaveCSS("padding", "0px");
    await expect(page.locator(".run-page")).toHaveCSS("gap", "0px");
    const shellBox = await shell.boundingBox();
    expect(shellBox).not.toBeNull();
    expect(shellBox!.x).toBe(0);
    expect(shellBox!.y).toBe(0);
    expect(shellBox!.width).toBe(width);
    expect(shellBox!.height).toBe(900);
    const composerFrame = await composer.evaluate((element) => {
      const style = getComputedStyle(element);
      return { borderWidth: parseFloat(style.borderTopWidth), radius: parseFloat(style.borderTopLeftRadius) };
    });
    expect(composerFrame.borderWidth).toBeGreaterThan(0);
    expect(composerFrame.radius).toBeGreaterThan(0);
    await expect(conversation.locator(".chat-message-user").getByText("确认理解，进入技术方案", { exact: true })).toHaveCount(1);
    await expect(conversation.getByRole("heading", { name: "第 1 版需求分析" })).toHaveCount(1);
    await expect(conversation.getByRole("heading", { name: "第 6 版需求分析" })).toHaveCount(1);
    const scrollBox = await conversation.boundingBox();
    const composerBefore = await composer.boundingBox();
    expect(scrollBox).not.toBeNull();
    expect(composerBefore).not.toBeNull();
    expect(scrollBox!.y + scrollBox!.height).toBeLessThanOrEqual(composerBefore!.y + 1);
    expect(composerBefore!.y + composerBefore!.height).toBeLessThanOrEqual(900);
    expect(await conversation.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(500);

    await conversation.evaluate((element) => { element.scrollTop = 0; });
    await expect(conversation.getByRole("heading", { name: "第 1 版需求分析" })).toBeInViewport();
    await expect(confirmation).not.toBeInViewport();
    await expect(input).toBeInViewport();
    await input.fill("正在回看第一版，输入框仍可使用。");
    await expect(input).toHaveValue("正在回看第一版，输入框仍可使用。");
    await expect(composer.getByRole("button", { name: "提交并重新分析" })).toBeEnabled();
    const composerAfter = await composer.boundingBox();
    expect(composerAfter!.y).toBeCloseTo(composerBefore!.y, 0);

    await conversation.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(confirmation).toBeInViewport();
    await expect(conversation.getByText("最终技术方案：", { exact: false })).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (width === 390 || width === 1440) {
      await input.fill("");
      await page.screenshot({ path: `/tmp/naxe-unframed-chat-${width}.png` });
    }
  });
}

test("collapses the desktop sidebar without hiding the conversation and input", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/runs/${fixtures().confirmableRunId}`);

  const sidebar = page.getByRole("complementary", { name: "产品工厂导航" });
  const collapse = page.getByRole("button", { name: "收起导航" });
  await collapse.click();

  await expect(sidebar).toHaveClass(/is-collapsed/);
  await expect(page.getByRole("button", { name: "展开导航" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("main", { name: "对话记录" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "补充回答或修改意见" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "确认理解，进入技术方案" })).toBeVisible();
});

test("opens and closes the mobile sidebar without leaving an overlay over the confirmation controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/runs/${fixtures().confirmableRunId}`);

  const sidebar = page.getByRole("complementary", { name: "产品工厂导航" });
  const overlay = page.locator("button.sidebar-overlay");
  await page.getByRole("button", { name: "打开导航" }).click();
  await expect(sidebar).toHaveClass(/is-mobile-open/);
  await expect(overlay).toHaveClass(/is-visible/);

  const overlayBox = await overlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  await overlay.click({ position: { x: overlayBox!.width - 12, y: overlayBox!.height / 2 } });
  await expect(sidebar).not.toHaveClass(/is-mobile-open/);
  await expect(overlay).not.toHaveClass(/is-visible/);
  await expect(overlay).toHaveAttribute("tabindex", "-1");
  await expect(overlay).toHaveCSS("pointer-events", "none");
  await expect(page.getByRole("button", { name: "确认理解，进入技术方案" })).toBeVisible();
});
