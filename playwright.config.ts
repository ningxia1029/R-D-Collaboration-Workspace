import { defineConfig, devices } from "@playwright/test";

const port = 3108;
// 统一使用 localhost，避免 NextAuth 回调在 localhost/127.0.0.1 间切换导致会话 Cookie 丢失。
const baseURL = `http://localhost:${port}`;
const ciSecret = "phase-eight-e2e-secret-at-least-32-bytes";
const workbenchRbacUatEnabled = process.env.WORKBENCH_RBAC_E2E === "1";
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL ?? "postgresql://e2e:e2e@127.0.0.1:5432/workbuddy_e2e";

// 真实写操作仅能进入 CI service container 的固定一次性数据库，绝不接受共享或生产 URL。
if (workbenchRbacUatEnabled) {
  const database = new URL(e2eDatabaseUrl);
  const ciTarget = database.protocol === "postgresql:"
    && database.hostname === "127.0.0.1"
    && database.port === "5432"
    && database.pathname === "/workbuddy_workbench_uat_ci";
  const localTarget = database.protocol === "postgresql:"
    && database.hostname === "127.0.0.1"
    && database.port === "55432"
    && database.pathname === "/workbuddy_uat"
    && process.env.WORKBENCH_RBAC_LOCAL_UAT_ACK === "workbuddy_uat";
  if (!ciTarget && !localTarget) {
    throw new Error("WORKBENCH_RBAC_E2E 只能使用固定 CI 库，或双确认的 127.0.0.1:55432/workbuddy_uat");
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["json", { outputFile: "output/playwright/phase8-results.json" }]],
  outputDir: "output/playwright/test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "npm run standalone:prepare && node .next/standalone/server.js",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: e2eDatabaseUrl,
      AUTH_SECRET: process.env.AUTH_SECRET ?? ciSecret,
      AUTH_URL: baseURL,
      AUTH_TRUST_HOST: "true",
      AGENT_INTERNAL_SERVICE_SECRET: process.env.AGENT_INTERNAL_SERVICE_SECRET ?? ciSecret,
      AGENT_DELEGATION_SECRET: process.env.AGENT_DELEGATION_SECRET ?? ciSecret,
      AGENT_CURSOR_SECRET: process.env.AGENT_CURSOR_SECRET ?? ciSecret,
      AGENT_ACTION_APPROVAL_SECRET: process.env.AGENT_ACTION_APPROVAL_SECRET ?? ciSecret,
    },
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 5"] },
      testIgnore: /workbench-rbac\.spec\.ts/,
    },
  ],
});
