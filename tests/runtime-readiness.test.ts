import test from "node:test";
import assert from "node:assert/strict";
import { inspectRuntimeReadiness } from "../src/lib/runtimeReadiness";
import { GET as live } from "../src/app/api/health/live/route";
import { GET as ready } from "../src/app/api/health/ready/route";

const VALID_SECRET = "runtime-readiness-secret-with-at-least-32-characters";
const VALID_ENV = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://readonly:never-expose@db.invalid:5432/workbuddy",
  AUTH_SECRET: VALID_SECRET,
  NEXT_PUBLIC_DEMO_MODE: "false",
  DEPLOYMENT_ENV: "production",
  AUTH_RATE_LIMIT_MODE: "gateway",
};

async function withProcessEnv<T>(
  values: Record<string, string | undefined>,
  action: () => Promise<T>,
): Promise<T> {
  const previous = new Map(
    Object.keys(values).map((key) => [key, { exists: key in process.env, value: process.env[key] }]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await action();
  } finally {
    for (const [key, value] of previous) {
      if (value.exists) process.env[key] = value.value;
      else delete process.env[key];
    }
  }
}

test("运行配置拒绝缺失 DATABASE_URL，且结果不泄露连接串或密钥", () => {
  const result = inspectRuntimeReadiness({ ...VALID_ENV, DATABASE_URL: undefined });

  assert.deepEqual(result, { ready: false, issues: ["DATABASE_URL_MISSING"] });
  assert.equal(JSON.stringify(result).includes(VALID_ENV.DATABASE_URL), false);
  assert.equal(JSON.stringify(result).includes(VALID_SECRET), false);
});

test("运行配置拒绝弱 AUTH_SECRET", () => {
  assert.deepEqual(inspectRuntimeReadiness({ ...VALID_ENV, AUTH_SECRET: "too-short" }), {
    ready: false,
    issues: ["AUTH_SECRET_WEAK"],
  });
});

test("运行配置拒绝长度足够但公开可猜的占位密钥", () => {
  assert.deepEqual(inspectRuntimeReadiness({
    ...VALID_ENV,
    AUTH_SECRET: "REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES",
  }), {
    ready: false,
    issues: ["AUTH_SECRET_PLACEHOLDER"],
  });
});

test("生产环境拒绝演示模式", () => {
  assert.deepEqual(inspectRuntimeReadiness({ ...VALID_ENV, NEXT_PUBLIC_DEMO_MODE: "true" }), {
    ready: false,
    issues: ["DEMO_MODE_ENABLED"],
  });
});

test("生产环境只接受已落地的网关限流，隔离 UAT 必须显式标记", () => {
  assert.deepEqual(inspectRuntimeReadiness({ ...VALID_ENV, AUTH_RATE_LIMIT_MODE: "memory" }), {
    ready: false,
    issues: ["AUTH_RATE_LIMIT_UNSAFE"],
  });
  assert.deepEqual(inspectRuntimeReadiness({
    ...VALID_ENV,
    DEPLOYMENT_ENV: "uat",
    AUTH_RATE_LIMIT_MODE: "isolated-uat",
  }), { ready: true, issues: [] });
  assert.deepEqual(inspectRuntimeReadiness({ ...VALID_ENV, AUTH_RATE_LIMIT_MODE: "shared-store" }), {
    ready: false,
    issues: ["AUTH_RATE_LIMIT_UNSAFE"],
  });
});

test("合法生产配置通过运行门禁", () => {
  assert.deepEqual(inspectRuntimeReadiness(VALID_ENV), { ready: true, issues: [] });
});

test("live 探针不依赖配置并仅返回存活状态", async () => {
  const response = await live();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "live" });
});

test("ready 在配置无效时返回 503，且不返回秘密值", async () => {
  await withProcessEnv({ ...VALID_ENV, DATABASE_URL: undefined }, async () => {
    const response = await ready();

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.deepEqual(body, { status: "not_ready", issues: ["DATABASE_URL_MISSING"] });
    assert.equal(JSON.stringify(body).includes(VALID_SECRET), false);
  });
});

test("ready 在 PostgreSQL SELECT 1 失败时返回 503", async () => {
  await withProcessEnv(
    {
      ...VALID_ENV,
      DATABASE_URL: "postgresql://readonly:never-expose@127.0.0.1:1/workbuddy?connect_timeout=1",
    },
    async () => {
      const response = await ready();

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: "not_ready", issues: ["DATABASE_UNAVAILABLE"] });
    },
  );
});
