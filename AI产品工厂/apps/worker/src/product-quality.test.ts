import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectProductHtml, runProductQuality } from "./product-quality";

const validHtml = `<!doctype html>
<html lang="zh-CN">
  <body>
    <form id="recommend-form">
      <input name="taste" />
      <button type="submit">提交</button>
    </form>
    <section id="result" aria-live="polite"></section>
    <script>
      document.querySelector('form').addEventListener('submit', async (event) => {
        event.preventDefault();
        await fetch('/api/v1/recommend', { method: 'POST' });
      });
    </script>
  </body>
</html>`;

describe("inspectProductHtml", () => {
  it("accepts a self-contained interactive product and extracts its internal API", () => {
    const report = inspectProductHtml(validHtml);

    expect(report.passed).toBe(true);
    expect(report.internalApiPaths).toEqual(["/api/v1/recommend"]);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  it("rejects external resources and embedded secrets", () => {
    const secretFixture = ["sk", "fixture-secret-value-123"].join("-");
    const report = inspectProductHtml(
      validHtml.replace(
        "</body>",
        `<img src="https://example.com/a.png"><script>const apiKey = "${secretFixture}";</script></body>`
      )
    );

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "no-external-resources")?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "no-embedded-secrets")?.passed).toBe(false);
  });
});

describe("isolated product browser validation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when the browser is unavailable", async () => {
    vi.stubEnv("FACTORY_BROWSER_CHANNEL", "nonexistent-fixture-channel");
    const report = await runProductQuality(validHtml);
    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "browser-runtime")?.detail).toContain("浏览器验证未完成");
  });

  it("does not claim interaction success for an inert button", async () => {
    const report = await runProductQuality(`<!doctype html><html><body>
      <button>没有处理函数</button><script>document.addEventListener('DOMContentLoaded', () => {});</script>
      </body></html>`);
    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "browser-interaction")?.passed).toBe(false);
  }, 20_000);

  it("fails broken scripts and missing handlers instead of granting a static pass", async () => {
    const report = await runProductQuality(`<!doctype html><html><body>
      <button onclick="missingHandler()">运行</button><script>const broken = ;</script>
      </body></html>`);
    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "browser-runtime")?.passed).toBe(false);
  }, 20_000);

  it("never uses factory APIs as fake product backend evidence", async () => {
    const report = await runProductQuality(validHtml);
    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "isolated-network")?.passed).toBe(false);
  }, 20_000);

  it("executes a real local interaction and reports only smoke coverage", async () => {
    const report = await runProductQuality(`<!doctype html><html><body>
      <button onclick="document.getElementById('result').textContent='完成'">运行</button>
      <p id="result">等待</p></body></html>`);
    expect(report.passed).toBe(true);
    expect(report.checks.find((check) => check.id === "browser-interaction")?.passed).toBe(true);
  }, 20_000);
});
