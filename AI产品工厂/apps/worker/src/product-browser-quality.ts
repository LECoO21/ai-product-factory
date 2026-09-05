import { chromium } from "playwright";
import type { ProductQualityCheck } from "./product-quality";

/** A fresh, credential-free Chromium context. Generated code never runs on the
 * factory origin or connects to a real service; this is smoke evidence, not PRD acceptance. */
export async function inspectProductInBrowser(html: string): Promise<ProductQualityCheck[]> {
  const errors = new Set<string>();
  let networkViolation = false;
  let exercised = 0;
  let changed = false;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await chromium.launch({
      channel: process.env.FACTORY_BROWSER_CHANNEL?.trim() || "chrome",
      headless: true, chromiumSandbox: true, timeout: 10_000
    });
    const activeBrowser = browser;
    deadline = setTimeout(() => { void activeBrowser.close(); }, 15_000);
    const context = await browser.newContext({
      // The opaque CSP sandbox already forbids service workers. Playwright's
      // serviceWorkers:block init script itself throws in an opaque origin.
      offline: true, acceptDownloads: false,
      permissions: [], viewport: { width: 1280, height: 800 }
    });
    const documentUrl = "https://prodline-preview.invalid/";
    let documentServed = false;
    await context.route("**/*", async (route) => {
      if (!documentServed && route.request().url() === documentUrl && route.request().isNavigationRequest()) {
        documentServed = true;
        await route.fulfill({ status: 200, contentType: "text/html", body: html,
          headers: { "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'" }
        });
      } else {
        networkViolation = true;
        await route.abort();
      }
    });
    await context.routeWebSocket("**/*", (socket) => { networkViolation = true; socket.close(); });
    const page = await context.newPage();
    page.setDefaultTimeout(1_000);
    page.on("pageerror", (error) => errors.add(error.message.slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.add(message.text().slice(0, 300));
    });
    page.on("dialog", (dialog) => { changed = true; void dialog.dismiss(); });
    // CSP violations may be blocked before a request reaches routing.
    await page.exposeFunction("recordPolicyViolation", () => { networkViolation = true; });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", () => {
        const report = Reflect.get(window, "recordPolicyViolation");
        if (typeof report === "function") void report();
      });
    });
    await page.goto(documentUrl, { waitUntil: "load", timeout: 5_000 });
    const controls = page.locator("button, input:not([type=hidden]), textarea, select, canvas, [role=button]");
    const limit = Math.min(await controls.count(), 12);
    for (let index = 0; index < limit; index++) {
      const control = controls.nth(index);
      if (!await control.isVisible() || !await control.isEnabled()) continue;
      const before = await page.content();
      const tag = await control.evaluate((element) => element.tagName.toLowerCase());
      const inputType = await control.getAttribute("type");
      if ((tag === "textarea" || tag === "input") &&
          !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "date", "time"].includes(inputType ?? "")) {
        await control.fill(inputType === "number" ? "1" : inputType === "email" ? "test@example.invalid" : "测试内容");
      } else if (tag === "select") {
        if (await control.locator("option").count() > 1) await control.selectOption({ index: 1 });
        else continue;
      } else if (inputType === "file") {
        continue;
      } else {
        await control.click({ timeout: 1_000 });
      }
      exercised++;
      // Allow event handlers/microtasks and short UI updates to settle; no network is permitted.
      await page.waitForTimeout(80);
      changed ||= before !== await page.content();
    }
    await page.waitForTimeout(150);
    return [
      { id: "browser-runtime", label: "浏览器脚本冒烟", passed: errors.size === 0,
        detail: errors.size ? [...errors].slice(0, 4).join("；") : "真实 Chromium 加载与控件操作期间未捕获脚本/控制台错误" },
      { id: "browser-interaction", label: "可观察交互", passed: exercised > 0 && changed,
        detail: `抽查 ${exercised} 个控件，${changed ? "观察到页面变化" : "未观察到页面变化，需补充交互测试"}；不代表全部业务功能通过` },
      { id: "isolated-network", label: "独立运行与网络隔离", passed: !networkViolation,
        detail: networkViolation ? "触发被禁止的资源/网络/表单访问；需要独立产品后端或补全自包含实现" : "在无凭据、无外部网络的隔离上下文中运行；未访问工厂 API" }
    ];
  } catch (error) {
    return [{ id: "browser-runtime", label: "浏览器脚本冒烟", passed: false,
      detail: `浏览器验证未完成，不能放行：${error instanceof Error ? error.message.slice(0, 300) : "浏览器不可用"}` }];
  } finally {
    clearTimeout(deadline);
    await browser?.close();
  }
}
