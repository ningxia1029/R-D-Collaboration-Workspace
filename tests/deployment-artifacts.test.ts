import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

function composeServiceBlock(compose: string, service: string) {
  const match = compose.match(new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [A-Za-z][A-Za-z0-9_-]*:\\n|^volumes:|^networks:|(?![\\s\\S]))`, "m"));
  assert.ok(match, `缺少 ${service} 服务`);
  return match[1];
}

function validateSelfhostEnv(overrides: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-selfhost-env.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      SELFHOST_POSTGRES_PASSWORD: "postgres_" + "a".repeat(32),
      SELFHOST_AUTH_SECRET: "auth_" + "b".repeat(40),
      SELFHOST_BACKUP_INTERVAL_SECONDS: "86400",
      SELFHOST_BACKUP_RETENTION_DAYS: "7",
      CLOUDFLARE_TUNNEL_TOKEN: "",
      ...overrides,
    },
  });
}

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

test("本机自托管 UAT 栈隔离数据库、秘密与可选隧道", () => {
  const compose = fs.readFileSync("docker-compose.selfhost.yml", "utf8");
  const example = fs.readFileSync(".env.selfhost.example", "utf8");
  const generator = fs.readFileSync("scripts/new-selfhost-env.ps1", "utf8");
  const validator = fs.readFileSync("scripts/validate-selfhost-env.ts", "utf8");

  assert.match(compose, /^name: workbuddy-selfhost$/m);
  const preflight = composeServiceBlock(compose, "preflight");
  const db = composeServiceBlock(compose, "db");
  const migrate = composeServiceBlock(compose, "migrate");
  const seed = composeServiceBlock(compose, "seed");
  const app = composeServiceBlock(compose, "app");
  const tunnel = composeServiceBlock(compose, "tunnel");

  assert.match(db, /image: postgres:16/);
  assert.match(db, /POSTGRES_DB: workbuddy_selfhost_uat/);
  assert.doesNotMatch(db, /^    ports:/m);
  assert.match(db, /depends_on:\n      preflight:\n        condition: service_completed_successfully/);
  assert.match(app, /127\.0\.0\.1:\$\{SELFHOST_APP_PORT:-3010\}:3000/);
  assert.match(compose, /frontend:/);
  assert.match(compose, /backend:\n\s+internal: true/);
  assert.match(tunnel, /profiles: \["tunnel"\]/);
  assert.match(tunnel, /cloudflare\/cloudflared@sha256:0aa26e284f05e6c77ae375b8c9c11d9eb6a448fb7bcd8d40f31cb6176189eb38/);
  assert.match(tunnel, /TUNNEL_TOKEN: \$\{CLOUDFLARE_TUNNEL_TOKEN:-\}/);
  assert.match(tunnel, /tunnel --no-autoupdate run/);
  assert.match(tunnel, /networks: \[frontend\]/);
  assert.doesNotMatch(tunnel, /backend/);
  assert.match(app, /migrate:\n        condition: service_completed_successfully/);
  assert.match(seed, /profiles: \["demo-seed"\]/);
  assert.match(seed, /DEMO_SEED_ALLOW: "1"/);
  assert.match(seed, /DEMO_SEED_TARGET_ACK: workbuddy_selfhost_uat/);
  assert.match(migrate, /preflight:\n        condition: service_completed_successfully/);

  const appEnvironmentKeys = [...app.matchAll(/^      ([A-Z_]+):/gm)].map((match) => match[1]);
  assert.deepEqual(appEnvironmentKeys, ["DATABASE_URL", "AUTH_SECRET", "AUTH_TRUST_HOST", "NEXT_PUBLIC_DEMO_MODE", "DEPLOYMENT_ENV", "AUTH_RATE_LIMIT_MODE"]);
  assert.match(app, /DATABASE_URL: postgresql:\/\/workbuddy_selfhost:\$\{SELFHOST_POSTGRES_PASSWORD\}@db:5432\/workbuddy_selfhost_uat/);
  assert.match(app, /AUTH_SECRET: \$\{SELFHOST_AUTH_SECRET:\?请设置至少 32 位的 SELFHOST_AUTH_SECRET\}/);
  assert.match(app, /AUTH_TRUST_HOST: "true"/);
  assert.match(app, /NEXT_PUBLIC_DEMO_MODE: "false"/);
  assert.match(app, /DEPLOYMENT_ENV: uat/);
  assert.match(app, /AUTH_RATE_LIMIT_MODE: isolated-uat/);
  for (const service of [preflight, db, migrate, seed, app, tunnel]) {
    assert.match(service, /logging: \*bounded-logging/);
  }
  for (const service of [preflight, db, migrate, seed, app, tunnel]) {
    assert.match(service, /security_opt:|<<: \*restricted-security/);
    assert.match(service, /cap_drop:|<<: \*restricted-security/);
  }
  assert.match(db, /healthcheck:/);
  assert.match(app, /healthcheck:/);
  assert.match(compose, /x-restricted-security: &restricted-security\n  security_opt:\n    - no-new-privileges:true\n  cap_drop:\n    - ALL/);
  assert.match(compose, /x-bounded-logging: &bounded-logging\n  driver: json-file\n  options:\n    max-size: "10m"\n    max-file: "3"/);
  assert.match(db, /workbuddy_selfhost_uat_pgdata:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /workbuddy_selfhost_uat_pgdata/);
  assert.match(compose, /^volumes:\n  workbuddy_selfhost_uat_pgdata:$/m);
  assert.doesNotMatch(compose, /workbuddy_uat_pgdata/);

  for (const key of ["SELFHOST_POSTGRES_PASSWORD", "SELFHOST_AUTH_SECRET", "SELFHOST_DEMO_PASSWORD", "CLOUDFLARE_TUNNEL_TOKEN"]) {
    assert.match(example, new RegExp(`^${key}=$`, "m"));
  }
  const gitignore = fs.readFileSync(".gitignore", "utf8");
  assert.match(gitignore, /^\.env\.selfhost$/m);
  assert.match(gitignore, /^backups\/$/m);
  assert.doesNotMatch(gitignore, /^!\.env\.selfhost\.example$/m);
  assert.match(generator, /RandomNumberGenerator/);
  assert.match(generator, /New-UrlSafeSecret 24/);
  assert.match(generator, /New-UrlSafeSecret 32/);
  assert.match(generator, /New-UrlSafeSecret 24\)!aA9/);
  assert.match(generator, /\$demoPassword.*!aA9/);
  assert.match(generator, /if \(\(Test-Path -LiteralPath \$resolvedOutput\) -and -not \$Force\)/);
  assert.match(generator, /TrimEnd\('='\)\.Replace\('\+', '-'\)\.Replace\('\/', '_'\)/);
  assert.match(generator, /\$tempPath = Join-Path \$parent/);
  assert.match(generator, /UTF8Encoding.*\$false/);
  assert.match(generator, /-Force/);
  assert.match(generator, /Move-Item[^\r\n]*\| Out-Null/);
  assert.doesNotMatch(generator, /[^\x00-\x7F]/);
  assert.doesNotMatch(generator, /Write-Host.*\$(?:dbPassword|authSecret|demoPassword)/i);
  assert.doesNotMatch(generator, /Write-(?:Host|Output|Error).*SELFHOST_(?:POSTGRES_PASSWORD|AUTH_SECRET|DEMO_PASSWORD)/i);
  assert.match(generator, /\[Console\]::Out\.WriteLine\(\$resolvedOutput\)/);
  assert.match(validator, /\^\[A-Za-z0-9\._~-\]\+\$/);
  assert.match(validator, /postgresPassword\.length < 24/);
  assert.match(validator, /authSecret\.length < 32/);
  assert.match(validator, /postgresPassword === authSecret/);
  assert.match(validator, /backupIntervalSeconds < 3600 \|\| backupIntervalSeconds > 604800/);
  assert.match(validator, /backupRetentionDays < 1 \|\| backupRetentionDays > 90/);
  assert.match(validator, /your\(\?:_\|-\)\?\(\?:secret\|password\|token\|value\)/);
  assert.match(validator, /publicPlaceholderPattern\.test\(postgresPassword\)/);
  assert.match(validator, /publicPlaceholderPattern\.test\(authSecret\)/);
  assert.match(validator, /if \(errors\.length > 0\) throw new Error/);
  assert.match(validator, /tunnelToken.*eyJ/i);
  assert.match(validator, /tunnelToken\.length < 80/);
  for (const source of [compose, example, generator, validator]) assert.doesNotMatch(source, /neon\.tech|Demo@123456|(?:sk|cf|eyJ)[A-Za-z0-9_-]{24,}/);
});

test("自托管预检只拒绝完整公开占位词及其数字或分隔符后缀", () => {
  const valid = validateSelfhostEnv({
    SELFHOST_POSTGRES_PASSWORD: "democracy_" + "a".repeat(32),
    SELFHOST_AUTH_SECRET: "yourself_" + "b".repeat(40),
  });
  assert.equal(valid.status, 0, valid.stderr);

  for (const value of ["changeme123", "replace-me-123", "your-secret-123", "demo-123"]) {
    const result = validateSelfhostEnv({ SELFHOST_POSTGRES_PASSWORD: value + "1".repeat(32) });
    assert.notEqual(result.status, 0, `${value} 必须被拒绝`);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(value));
  }
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
