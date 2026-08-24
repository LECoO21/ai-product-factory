import { describe, expect, it } from "vitest";
import { inspectProductHtml } from "./product-quality";

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
    const report = inspectProductHtml(
      validHtml.replace("</body>", '<img src="https://example.com/a.png"><script>const apiKey = "sk-secret-value-123456789";</script></body>')
    );

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "no-external-resources")?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "no-embedded-secrets")?.passed).toBe(false);
  });
});
