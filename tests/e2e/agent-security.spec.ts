import { expect, test } from "@playwright/test";

test("登录页可访问且带有生产安全响应头", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "PLM 研发协同平台" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();

  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("未登录用户不能进入 Agent 页面或调用 Run/Action API", async ({ page, request }) => {
  await page.goto("/agent");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fagent$/);

  const runResponse = await request.get("/api/agent/runs");
  expect(runResponse.status()).toBe(401);
  expect(await runResponse.json()).toMatchObject({ error: "未登录或会话已过期" });

  const actionResponse = await request.post("/api/agent/actions/not-owned/execute", {
    data: { confirmationText: "确认执行", approvalToken: "not-a-token" },
  });
  expect(actionResponse.status()).toBe(401);
});
