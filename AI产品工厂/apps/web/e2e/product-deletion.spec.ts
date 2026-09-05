import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`confirms deletion and removes only the test product at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const name = `E2E 删除测试产品 ${viewport.width}`;
    // Playwright's isolated server/data directory is used; no real product is touched.
    const created = await page.request.post("/api/projects", {
      headers: { origin: "http://localhost:3100" },
      data: { name, description: "测试产品", workspacePath: null, prd: "用于验证产品删除按钮，取消、确认及历史记录刷新，不调用模型。" }
    });
    expect(created.status()).toBe(201);
    const { project } = await created.json() as { project: { id: string } };
    const started = await page.request.post(`/api/projects/${project.id}/runs`, { headers: { origin: "http://localhost:3100" }, data: { objective: "验证排队产品删除" } });
    expect(started.ok()).toBe(true);
    const { run } = await started.json() as { run: { id: string } };
    const list = await page.request.get("/api/projects");
    const before = await list.json() as { projects: Array<{ id: string }> };

    await page.goto(`/projects/${project.id}`);
    const deleteButton = page.getByRole("button", { name: "删除产品", exact: true });
    await expect(deleteButton).toBeVisible();
    await page.screenshot({ path: `/tmp/naxe-delete-product-${viewport.width}.png` });
    await deleteButton.click();
    const dialog = page.getByRole("dialog", { name: "删除产品？" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(name, { exact: false })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(deleteButton).toBeFocused();
    await deleteButton.click();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(`/projects/${project.id}`);

    await deleteButton.click();
    await page.screenshot({ path: `/tmp/naxe-delete-confirm-${viewport.width}.png` });
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport.width);
    await dialog.getByRole("button", { name: "确认删除" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.locator(`.sidebar-project-list a[href="/projects/${project.id}"]`)).toHaveCount(0);
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.locator(`.sidebar-project-list a[href="/projects/${project.id}"]`)).toHaveCount(0);
    const afterResponse = await page.request.get("/api/projects");
    const after = await afterResponse.json() as { projects: Array<{ id: string }> };
    expect(after.projects.map((entry) => entry.id).sort()).toEqual(before.projects.filter((entry) => entry.id !== project.id).map((entry) => entry.id).sort());
    expect((await page.request.get(`/api/runs/${run.id}`)).status()).toBe(404);
    expect((await page.request.get(`/api/runs/${run.id}/events`)).status()).toBe(404);
    expect((await page.request.post(`/api/projects/${project.id}/runs`, { headers: { origin: "http://localhost:3100" }, data: { objective: "不能重新开始" } })).status()).toBe(404);
    expect(errors).toEqual([]);
  });
}
