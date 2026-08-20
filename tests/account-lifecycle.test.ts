import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validatePassword } from "../src/lib/passwordPolicy";
import { isSessionVersionCurrent } from "../src/lib/rbac";

const root = resolve(import.meta.dirname, "..");
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

test("密码策略要求至少 12 位并同时包含大小写字母、数字和特殊字符", () => {
  assert.equal(validatePassword("ValidPass12!").valid, true);

  for (const password of [
    "Short1!",
    "lowercase123!",
    "UPPERCASE123!",
    "NoDigitsHere!",
    "NoSpecial1234",
    "ValidPass12 ",
  ]) {
    assert.equal(validatePassword(password).valid, false, `${password} 不应通过密码策略`);
  }
});

test("密码策略是确定性的纯函数并返回可展示的失败原因", () => {
  const first = validatePassword("weak");
  const second = validatePassword("weak");

  assert.deepEqual(first, second);
  assert.equal(first.valid, false);
  assert.ok(first.errors.length >= 4);
  assert.equal(validatePassword(`Aa1!${"x".repeat(125)}`).valid, false);
});

test("会话版本只有与数据库当前版本完全一致时才有效", () => {
  assert.equal(isSessionVersionCurrent(1, 1), true);
  assert.equal(isSessionVersionCurrent(1, 2), false);
  assert.equal(isSessionVersionCurrent(undefined, 1), false);
  assert.equal(isSessionVersionCurrent(0, 1), false);
});

test("User 生命周期字段与迁移保持 expand-only 默认兼容", () => {
  const schema = source("prisma/schema.prisma");
  const migrationPath = resolve(root, "prisma/migrations/20260820000000_account_lifecycle/migration.sql");

  assert.match(schema, /mustChangePassword\s+Boolean\s+@default\(false\)\s+@map\("must_change_password"\)/);
  assert.match(schema, /passwordChangedAt\s+DateTime\?\s+@map\("password_changed_at"\)/);
  assert.match(schema, /sessionVersion\s+Int\s+@default\(1\)\s+@map\("session_version"\)/);
  assert.equal(existsSync(migrationPath), true);

  const migration = source("prisma/migrations/20260820000000_account_lifecycle/migration.sql");
  assert.match(migration, /ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false/i);
  assert.match(migration, /ADD COLUMN "password_changed_at" TIMESTAMP\(3\)/i);
  assert.match(migration, /ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 1/i);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE|UPDATE)\b/i);
});

test("登录会话携带账号生命周期声明并由 requireAuth 对库中版本做即时校验", () => {
  const auth = source("src/lib/auth.ts");
  const config = source("src/lib/auth.config.ts");
  const rbac = source("src/lib/rbac.ts");
  const types = source("src/types/next-auth.d.ts");

  for (const field of ["mustChangePassword", "sessionVersion"]) {
    assert.match(auth, new RegExp(field));
    assert.match(config, new RegExp(field));
    assert.match(types, new RegExp(field));
  }
  assert.match(rbac, /isSessionVersionCurrent\([^)]*session\.user\.sessionVersion[^)]*current\.sessionVersion/);
  assert.match(rbac, /mustChangePassword/);
});

test("管理员账号写操作使用 Zod、强制首次改密、撤销会话并写无密码审计", () => {
  const route = source("src/app/api/admin/users/route.ts");

  assert.match(route, /from "zod"/);
  assert.match(route, /mustChangePassword:\s*true/);
  assert.match(route, /sessionVersion\s*=\s*\{\s*increment:\s*1\s*\}/);
  assert.match(route, /writeAudit/);
  assert.doesNotMatch(route, /diff:\s*\{[^}]*password/);
  assert.doesNotMatch(route, /\.\.\.user/);
});

test("改密接口验证当前密码、拒绝复用并在事务内更新生命周期与审计", () => {
  const routePath = "src/app/api/account/change-password/route.ts";
  assert.equal(existsSync(resolve(root, routePath)), true);
  const route = source(routePath);

  assert.match(route, /currentPassword/);
  assert.match(route, /validatePassword/);
  assert.ok((route.match(/bcrypt\.compare/g) ?? []).length >= 2);
  assert.match(route, /mustChangePassword:\s*false/);
  assert.match(route, /passwordChangedAt:\s*new Date\(\)/);
  assert.match(route, /sessionVersion:\s*\{\s*increment:\s*1\s*\}/);
  assert.match(route, /writeAudit\([\s\S]*?,\s*tx\)/);
  assert.doesNotMatch(route, /diff:\s*\{[^}]*Password/);
});

test("改密使用账号状态与会话版本 CAS，拒绝覆盖管理员的并发重置", () => {
  const route = source("src/app/api/account/change-password/route.ts");

  assert.match(route, /sessionUser\.sessionVersion/);
  assert.match(route, /updateMany\(\{[\s\S]*?where:\s*\{[\s\S]*?id:\s*current\.id[\s\S]*?status:\s*"active"[\s\S]*?sessionVersion:\s*expectedSessionVersion/);
  assert.match(route, /if \(updated\.count !== 1\)/);
});

test("临时密码会话只允许进入改密流程且成功页面会退出旧会话", () => {
  const middleware = source("src/middleware.ts");
  const pagePath = "src/app/(auth)/change-password/page.tsx";
  assert.equal(existsSync(resolve(root, pagePath)), true);
  const page = source(pagePath);

  assert.match(middleware, /mustChangePassword/);
  assert.match(middleware, /\/change-password/);
  assert.match(page, /signOut/);
  assert.match(page, /\/api\/account\/change-password/);
});

test("主应用由服务端校验会话，撤销页退出客户端会话且 middleware 不形成重定向环", () => {
  const layout = source("src/app/(main)/layout.tsx");
  const shellPath = "src/components/layout/MainShell.tsx";
  const revokedPath = "src/app/(auth)/session-revoked/page.tsx";
  const middleware = source("src/middleware.ts");

  assert.doesNotMatch(layout, /"use client"/);
  assert.match(layout, /await requireAuth\(\)/);
  assert.match(layout, /redirect\("\/session-revoked"\)/);
  assert.equal(existsSync(resolve(root, shellPath)), true);
  assert.equal(existsSync(resolve(root, revokedPath)), true);
  assert.match(source(revokedPath), /signOut\(\{\s*redirect:\s*false\s*\}\)/);
  assert.match(middleware, /isSessionRevokedPage/);
});

test("登录限流按 IP 与邮箱组合，并保持有界 TTL 存储", () => {
  const auth = source("src/lib/auth.ts");

  assert.match(auth, /x-forwarded-for/);
  assert.match(auth, /x-real-ip/);
  assert.match(auth, /clientIp[\s\S]*email/);
  assert.match(auth, /LOGIN_ATTEMPT_CAPACITY/);
  assert.match(auth, /resetAt\s*<=\s*now/);
  assert.match(auth, /loginAttempts\.size\s*>=\s*LOGIN_ATTEMPT_CAPACITY/);
});

test("两处密码表单复用纯密码策略，Zod 返回首个安全问题", () => {
  const adminPage = source("src/app/(main)/admin/users/page.tsx");
  const changePage = source("src/app/(auth)/change-password/page.tsx");
  const rbac = source("src/lib/rbac.ts");

  assert.match(adminPage, /validatePassword/);
  assert.match(changePage, /validatePassword/);
  assert.match(rbac, /issues\?\.\[0\]/);
  assert.match(rbac, /参数校验失败/);
});

test("演示 seed 在任何写入前执行环境、库名、确认值和密码门禁", () => {
  const seed = source("prisma/seed.ts");
  const firstWrite = seed.indexOf("deleteMany(");

  assert.match(seed, /NODE_ENV\s*===\s*"production"/);
  assert.match(seed, /DEMO_SEED_ALLOW\s*!==\s*"1"/);
  assert.match(seed, /DEMO_SEED_TARGET_ACK/);
  assert.match(seed, /DEMO_SEED_PASSWORD/);
  assert.match(seed, /validatePassword/);
  assert.match(seed, /\(\?:\^\|_\)\(\?:demo\|uat\|test\|ci\)\(\?:_\|\$\)/i);
  assert.ok(seed.indexOf("validateSeedEnvironment") < firstWrite);
  assert.doesNotMatch(seed, /Demo@123456/);
});

test("UAT seed 包装器向子进程注入 fail-closed 变量且 Compose 显式要求演示密码", () => {
  const script = source("scripts/seed-uat.ts");
  const compose = source("docker-compose.uat.yml");

  assert.match(script, /DEMO_SEED_ALLOW:\s*"1"/);
  assert.match(script, /DEMO_SEED_TARGET_ACK:\s*actualDatabase/);
  assert.match(script, /DEMO_SEED_PASSWORD:\s*uatDemoPassword/);
  assert.match(compose, /UAT_DEMO_PASSWORD:\s*\$\{UAT_DEMO_PASSWORD:\?/);
});

test("演示账号显式关闭首次改密且服务端不提供公共注册", () => {
  const seed = source("prisma/seed.ts");
  assert.equal((seed.match(/mustChangePassword:\s*false/g) ?? []).length, 4);
  assert.equal(existsSync(resolve(root, "src/app/api/register/route.ts")), false);
  assert.equal(existsSync(resolve(root, "src/app/(auth)/register/page.tsx")), false);
});
