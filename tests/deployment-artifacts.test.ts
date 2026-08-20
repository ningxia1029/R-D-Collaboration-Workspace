import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("容器运行层使用非 root standalone 且以 ready 探针接流", () => {
  const dockerfile = fs.readFileSync("Dockerfile", "utf8");
  assert.match(dockerfile, /FROM node:24\.12\.0-bookworm-slim AS runner/);
  assert.match(dockerfile, /USER nextjs/);
  assert.match(dockerfile, /install -y --no-install-recommends ca-certificates openssl/);
  assert.match(dockerfile, /COPY prisma \.\/prisma\s+RUN npm ci/);
  assert.match(dockerfile, /COPY --from=builder .*\.next\/standalone/);
  assert.match(dockerfile, /api\/health\/ready/);
  assert.doesNotMatch(dockerfile, /COPY \.env/);
});

test("UAT 编排固定使用 PostgreSQL 16 和隔离数据库名", () => {
  const compose = fs.readFileSync("docker-compose.uat.yml", "utf8");
  assert.match(compose, /image: postgres:16/);
  assert.match(compose, /POSTGRES_DB: workbuddy_uat/);
  assert.match(compose, /UAT_POSTGRES_PASSWORD:\?/);
  assert.match(compose, /DATABASE_URL: postgresql:\/\/workbuddy_uat:\$\{UAT_POSTGRES_PASSWORD\}@db/);
  assert.doesNotMatch(compose, /neon\.tech|Demo@123456/);
  assert.match(compose, /profiles: \["demo-seed"\]/);
  assert.doesNotMatch(compose, /app:[\s\S]*command:.*seed/);
});

test("生产环境模板不包含演示模式或可用秘密值", () => {
  const example = fs.readFileSync(".env.production.example", "utf8");
  assert.match(example, /NEXT_PUBLIC_DEMO_MODE=false/);
  assert.match(example, /DEPLOYMENT_ENV=production/);
  assert.match(example, /AUTH_RATE_LIMIT_MODE=gateway/);
  assert.match(example, /^AUTH_SECRET=$/m);
  assert.doesNotMatch(example, /^AGENT_.*SECRET=\S+/m);
  assert.doesNotMatch(example, /@.*neon\.tech|Demo@123456/);
});

test("UAT seed 脚本具有数据库名和人工确认双门禁", () => {
  const script = fs.readFileSync("scripts/seed-uat.ts", "utf8");
  assert.match(script, /expectedDatabase = "workbuddy_uat"/);
  assert.match(script, /UAT_SEED_TARGET_ACK/);
  assert.match(script, /actualDatabase !== expectedDatabase \|\| targetAck !== expectedDatabase/);
});

test("UAT 环境预检拒绝需要 URL 编码的数据库密码和公开占位密钥", () => {
  const script = fs.readFileSync("scripts/validate-uat-env.ts", "utf8");
  assert.match(script, /\^\[A-Za-z0-9\._~-\]\+\$/);
  assert.match(script, /postgresPassword\.length < 24/);
  assert.match(script, /authSecret\.length < 32/);
  assert.match(script, /postgresPassword === authSecret/);
});

test("Render Singapore UAT Blueprint 固定 PG16、迁移、健康检查和秘密边界", () => {
  const blueprint = fs.readFileSync("render.yaml", "utf8");

  assert.match(blueprint, /runtime: node/);
  assert.equal(blueprint.match(/region: singapore/g)?.length, 2);
  assert.match(blueprint, /plan: starter/);
  assert.match(blueprint, /plan: basic-256mb/);
  assert.match(blueprint, /postgresMajorVersion: "16"/);
  assert.match(blueprint, /databaseName: workbuddy_plm_uat/);
  assert.match(blueprint, /ipAllowList: \[\]/);
  assert.match(blueprint, /preDeployCommand: npx prisma migrate deploy/);
  assert.match(blueprint, /healthCheckPath: \/api\/health\/ready/);
  assert.match(blueprint, /fromDatabase:[\s\S]*property: connectionString/);
  assert.match(blueprint, /key: AUTH_SECRET\s+generateValue: true/);
  assert.match(blueprint, /key: DEPLOYMENT_ENV\s+value: uat/);
  assert.match(blueprint, /key: AUTH_RATE_LIMIT_MODE\s+value: isolated-uat/);
  assert.match(blueprint, /key: DEMO_SEED_PASSWORD\s+sync: false/);
  assert.match(blueprint, /initialDeployHook: NODE_ENV=uat npm run db:seed/);
  assert.doesNotMatch(blueprint, /neon\.tech|Demo@123456|BEGIN (?:RSA |EC )?PRIVATE KEY/);
});
