import { execFileSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL ?? "";
const expectedDatabase = "workbuddy_uat";
const targetAck = process.env.UAT_SEED_TARGET_ACK ?? "";
const uatDemoPassword = process.env.UAT_DEMO_PASSWORD ?? "";

let actualDatabase = "";
try {
  const parsed = new URL(databaseUrl);
  actualDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
} catch {
  throw new Error("DATABASE_URL 不是有效的 PostgreSQL URL");
}

if (actualDatabase !== expectedDatabase || targetAck !== expectedDatabase) {
  throw new Error(`拒绝 seed：目标数据库和 UAT_SEED_TARGET_ACK 必须同时为 ${expectedDatabase}`);
}
if (!uatDemoPassword) throw new Error("拒绝 seed：必须通过 UAT_DEMO_PASSWORD 注入演示账号密码");

console.log(`[uat-seed] target=${actualDatabase} acknowledged=true`);
execFileSync("npm", ["run", "db:seed"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    DEMO_SEED_ALLOW: "1",
    DEMO_SEED_TARGET_ACK: actualDatabase,
    DEMO_SEED_PASSWORD: uatDemoPassword,
  },
});
