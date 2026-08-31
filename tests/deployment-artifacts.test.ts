import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

function normalizeText(text: string) {
  return text.replace(/\r\n/g, "\n");
}

function readText(filePath: string) {
  return normalizeText(fs.readFileSync(filePath, "utf8"));
}

function composeServiceBlock(compose: string, service: string) {
  const normalizedCompose = normalizeText(compose);
  const match = normalizedCompose.match(new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [A-Za-z][A-Za-z0-9_-]*:\\n|^volumes:|^networks:|(?![\\s\\S]))`, "m"));
  assert.ok(match, `缺少 ${service} 服务`);
  return match[1];
}

function validateSelfhostEnv(overrides: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-selfhost-env.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      SELFHOST_POSTGRES_PASSWORD: "pg_A7mQ2xR9vK4nT8wZ5cL3hJ6sD1fG",
      SELFHOST_AUTH_SECRET: "auth_B8qL3yN7rV2kP6mX9tC4wH1dF5sJ",
      SELFHOST_BACKUP_INTERVAL_SECONDS: "86400",
      SELFHOST_BACKUP_RETENTION_DAYS: "7",
      SELFHOST_COMPOSE_PROJECT: "workbuddy-selfhost",
      CLOUDFLARE_TUNNEL_TOKEN: "",
      ...overrides,
    },
  });
}

test("容器运行层使用非 root standalone 且以 ready 探针接流", () => {
  const dockerfile = readText("Dockerfile");
  assert.match(dockerfile, /FROM node:24\.12\.0-bookworm-slim AS runner/);
  assert.match(dockerfile, /USER nextjs/);
  assert.match(dockerfile, /install -y --no-install-recommends ca-certificates openssl/);
  assert.match(dockerfile, /COPY prisma \.\/prisma\s+RUN npm ci/);
  assert.match(dockerfile, /COPY --from=builder .*\.next\/standalone/);
  assert.match(dockerfile, /api\/health\/ready/);
  assert.doesNotMatch(dockerfile, /COPY \.env/);
});

test("UAT 编排固定使用 PostgreSQL 16 和隔离数据库名", () => {
  const compose = readText("docker-compose.uat.yml");
  assert.match(compose, /image: postgres:16/);
  assert.match(compose, /POSTGRES_DB: workbuddy_uat/);
  assert.match(compose, /UAT_POSTGRES_PASSWORD:\?/);
  assert.match(compose, /DATABASE_URL: postgresql:\/\/workbuddy_uat:\$\{UAT_POSTGRES_PASSWORD\}@db/);
  assert.doesNotMatch(compose, /neon\.tech|Demo@123456/);
  assert.match(compose, /profiles: \["demo-seed"\]/);
  assert.doesNotMatch(compose, /app:[\s\S]*command:.*seed/);
});

test("生产环境模板不包含演示模式或可用秘密值", () => {
  const example = readText(".env.production.example");
  assert.match(example, /NEXT_PUBLIC_DEMO_MODE=false/);
  assert.match(example, /DEPLOYMENT_ENV=production/);
  assert.match(example, /AUTH_RATE_LIMIT_MODE=gateway/);
  assert.match(example, /^AUTH_SECRET=$/m);
  assert.doesNotMatch(example, /^AGENT_.*SECRET=\S+/m);
  assert.doesNotMatch(example, /@.*neon\.tech|Demo@123456/);
});

test("UAT seed 脚本具有数据库名和人工确认双门禁", () => {
  const script = readText("scripts/seed-uat.ts");
  assert.match(script, /expectedDatabase = "workbuddy_uat"/);
  assert.match(script, /UAT_SEED_TARGET_ACK/);
  assert.match(script, /actualDatabase !== expectedDatabase \|\| targetAck !== expectedDatabase/);
});

test("UAT 环境预检拒绝需要 URL 编码的数据库密码和公开占位密钥", () => {
  const script = readText("scripts/validate-uat-env.ts");
  assert.match(script, /^export \{\};$/m);
  assert.match(script, /\^\[A-Za-z0-9\._~-\]\+\$/);
  assert.match(script, /postgresPassword\.length < 24/);
  assert.match(script, /authSecret\.length < 32/);
  assert.match(script, /postgresPassword === authSecret/);
});

test("本机自托管 UAT 栈隔离数据库、秘密与可选隧道", () => {
  const compose = readText("docker-compose.selfhost.yml");
  const example = readText(".env.selfhost.example");
  const generator = readText("scripts/new-selfhost-env.ps1");
  const validator = readText("scripts/validate-selfhost-env.ts");
  const composeWrapper = readText("scripts/selfhost-compose.ps1");

  assert.match(compose, /^name: workbuddy-selfhost$/m);
  const preflight = composeServiceBlock(compose, "preflight");
  const db = composeServiceBlock(compose, "db");
  const migrate = composeServiceBlock(compose, "migrate");
  const seed = composeServiceBlock(compose, "seed");
  const app = composeServiceBlock(compose, "app");
  const tunnel = composeServiceBlock(compose, "tunnel");
  assert.equal(composeServiceBlock(compose.replace(/\r?\n/g, "\r\n"), "preflight"), preflight, "Compose 服务块解析必须兼容 Windows CRLF checkout");

  assert.match(db, /image: postgres:16/);
  assert.match(db, /POSTGRES_DB: workbuddy_selfhost_uat/);
  assert.match(db, /user: "999:999"/, "PostgreSQL 必须直接以镜像内 postgres 用户运行，避免 root 权限修复路径");
  assert.doesNotMatch(db, /cap_add:/, "PostgreSQL 不得通过附加文件能力绕过既有 PGDATA 权限");
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
  assert.match(preflight, /SELFHOST_COMPOSE_PROJECT: \$\{COMPOSE_PROJECT_NAME:-workbuddy-selfhost\}/);

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
  assert.match(example, /不要复制；运行 scripts\/new-selfhost-env\.ps1 生成真实文件/);
  const gitignore = readText(".gitignore");
  assert.match(gitignore, /^\.env\.selfhost$/m);
  assert.match(gitignore, /^backups\/$/m);
  assert.doesNotMatch(gitignore, /^!\.env\.selfhost\.example$/m);
  assert.match(generator, /RandomNumberGenerator/);
  assert.match(generator, /New-UrlSafeSecret 24/);
  assert.match(generator, /New-UrlSafeSecret 32/);
  assert.match(generator, /New-UrlSafeSecret 24\)!aA9/);
  assert.match(generator, /\$demoPassword.*!aA9/);
  assert.match(generator, /if \(\(Test-Path -LiteralPath \$resolvedOutput\) -and -not \$Force\)/);
  assert.doesNotMatch(generator, /OutputPath\s*=\s*\([^\r\n]*PSScriptRoot/);
  assert.match(generator, /TrimEnd\('='\)\.Replace\('\+', '-'\)\.Replace\('\/', '_'\)/);
  assert.match(generator, /\$tempPath = Join-Path \$parent/);
  assert.match(generator, /UTF8Encoding.*\$false/);
  assert.match(generator, /if \(\$Force\) \{[\s\S]*Move-Item[^\r\n]*-Force/);
  assert.match(generator, /else \{[\s\S]*\[System\.IO\.File\]::Move\(\$tempPath, \$resolvedOutput\)/);
  assert.doesNotMatch(generator, /[^\x00-\x7F]/);
  assert.doesNotMatch(generator, /Write-Host.*\$(?:dbPassword|authSecret|demoPassword)/i);
  assert.doesNotMatch(generator, /Write-(?:Host|Output|Error).*SELFHOST_(?:POSTGRES_PASSWORD|AUTH_SECRET|DEMO_PASSWORD)/i);
  assert.match(generator, /\[Console\]::Out\.WriteLine\(\$resolvedOutput\)/);
  assert.match(validator, /\^\[A-Za-z0-9\._~-\]\+\$/);
  assert.match(validator, /^export \{\};$/m);
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
  assert.match(validator, /new Set\(postgresPassword\)\.size < 8/);
  assert.match(validator, /new Set\(authSecret\)\.size < 8/);
  assert.match(validator, /SELFHOST_COMPOSE_PROJECT/);
  assert.match(validator, /composeProject !== "workbuddy-selfhost"/);
  assert.match(composeWrapper, /--project-name "workbuddy-selfhost"/);
  assert.match(composeWrapper, /--env-file \$envPath/);
  assert.match(composeWrapper, /ValueFromRemainingArguments/);
  assert.match(composeWrapper, /COMPOSE_PROJECT_NAME/);
  assert.doesNotMatch(composeWrapper, /Write-(?:Host|Output|Error).*SELFHOST_/i);
  for (const source of [compose, example, generator, validator]) assert.doesNotMatch(source, /neon\.tech|Demo@123456|(?:sk|cf|eyJ)[A-Za-z0-9_-]{24,}/);
});

test("自托管预检只拒绝完整公开占位词及其数字或分隔符后缀", () => {
  const valid = validateSelfhostEnv({
    SELFHOST_POSTGRES_PASSWORD: "democracy_A7mQ2xR9vK4nT8wZ5cL3hJ6sD1fG",
    SELFHOST_AUTH_SECRET: "yourself_B8qL3yN7rV2kP6mX9tC4wH1dF5sJ",
  });
  assert.equal(valid.status, 0, valid.stderr);

  for (const value of ["changeme123", "replace-me-123", "your-secret-123", "demo-123"]) {
    const result = validateSelfhostEnv({ SELFHOST_POSTGRES_PASSWORD: value + "1".repeat(32) });
    assert.notEqual(result.status, 0, `${value} 必须被拒绝`);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(value));
  }

  for (const [key, value] of [
    ["SELFHOST_POSTGRES_PASSWORD", "a".repeat(32)],
    ["SELFHOST_AUTH_SECRET", "abcd".repeat(10)],
  ] as const) {
    const result = validateSelfhostEnv({ [key]: value });
    assert.notEqual(result.status, 0, `${key} 的低多样性值必须被拒绝`);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(value));
  }
});

test("生成器在 Windows PowerShell 5.1 中不传 OutputPath 时使用脚本父目录", () => {
  if (process.platform !== "win32") return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workbuddy-selfhost-default-"));
  const scriptsDir = path.join(root, "scripts");
  const copiedScript = path.join(scriptsDir, "new-selfhost-env.ps1");
  const expectedEnv = path.join(root, ".env.selfhost");
  fs.mkdirSync(scriptsDir);
  fs.copyFileSync("scripts/new-selfhost-env.ps1", copiedScript);
  try {
    const result = spawnSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-File", copiedScript], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(expectedEnv));
    assert.equal(fs.realpathSync.native(result.stdout.trim()), fs.realpathSync.native(expectedEnv));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("自托管 Compose wrapper 将裸 -d 重构为 up 后的 --detach", () => {
  const source = readText("scripts/selfhost-compose.ps1");
  assert.match(source, /\[Alias\('d'\)\]\[switch\]\$Detach/);
  assert.match(source, /Normalize-ComposeArguments -ComposeArguments \$ComposeArgs -Detach:\$Detach/);
  const docs = `${readText("docs/SELF_HOSTED_UAT.md")}\n${readText("docs/superpowers/plans/2026-08-20-self-hosted-uat.md")}`;
  assert.doesNotMatch(docs, /selfhost-compose\.ps1[^\r\n`]*\s-d\b/);
  assert.doesNotMatch(docs, /selfhost-compose\.ps1[^\r\n`]*\s-e\b/, "PowerShell 会把 Compose 的 -e 误解析为公共参数缩写；必须使用 --env/--eval");
  assert.doesNotMatch(docs, /selfhost-compose\.ps1[^\r\n`]*\s-[a-zA-Z](?=\s|$)/, "wrapper 后不得使用会被 PowerShell 误绑定的单字母短参数");
  if (process.platform !== "win32") return;

  const wrapper = path.resolve("scripts/selfhost-compose.ps1").replace(/'/g, "''");
  const command = `& { . '${wrapper}'; (Normalize-ComposeArguments -ComposeArguments @('up', '--build', 'db', 'migrate', 'app') -Detach) -join ' ' }`;
  const result = spawnSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "up --detach --build db migrate app");
  for (const args of ["@('ps')", "@('up', '--detach')"]) {
    const invalid = spawnSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-Command", `& { . '${wrapper}'; Normalize-ComposeArguments -ComposeArguments ${args} -Detach }`], { encoding: "utf8" });
    assert.notEqual(invalid.status, 0);
  }
});

test("自托管备份、恢复和运行手册维持可审计且默认无写入的数据库运维边界", () => {
  const compose = readText("docker-compose.selfhost.yml");
  const backup = readText("scripts/selfhost-backup.sh");
  const restore = readText("scripts/selfhost-restore.sh");
  const handbook = readText("docs/SELF_HOSTED_UAT.md");
  const attributes = readText(".gitattributes");
  const composeWrapper = readText("scripts/selfhost-compose.ps1");

  assert.match(backup, /^#!\/bin\/sh\nset -eu\numask 077/m);
  assert.match(backup, /SELFHOST_BACKUP_INTERVAL_SECONDS/);
  assert.match(backup, /3600.*604800|604800.*3600/);
  assert.match(backup, /SELFHOST_BACKUP_RETENTION_DAYS/);
  assert.match(backup, /1.*90|90.*1/);
  assert.match(backup, /PGHOST.*PGUSER.*PGDATABASE.*PGPASSWORD/s);
  assert.match(backup, /pg_dump --format=custom --no-owner --no-acl/);
  assert.match(backup, /dump_partial=.*\.partial/);
  assert.match(backup, /mv "\$dump_partial" "\$dump_file"/);
  assert.match(backup, /sha256sum "\$dump_partial"/);
  assert.match(backup, /printf '%s  %s\\n' "\$hash" "\$dump_name" > "\$sha_partial"/);
  assert.match(backup, /mv "\$sha_partial" "\$sha_file"/);
  assert.match(backup, /trap .*partial/);
  assert.match(backup, /find .*workbuddy-\?\?\?\?\?\?\?\?-\?\?\?\?\?\?\.dump/);
  assert.match(backup, /\[ -f "\$dump" \].*\[ -f "\$sha" \]/s);
  assert.match(backup, /backup_once\nwhile :/);
  assert.match(backup, /is_backup_name\(\)/);
  assert.match(backup, /workbuddy-\[0-9\](?:\[0-9\]){7}-\[0-9\](?:\[0-9\]){5}\.dump/);
  assert.ok(backup.indexOf('sha256sum "$dump_partial"') < backup.indexOf('mv "$dump_partial" "$dump_file"'), "checksum 必须在 dump 发布前完成");
  assert.match(backup, /final_dump="\$dump_file"/);
  assert.match(backup, /final_sha="\$sha_file"/);
  assert.match(backup, /pair_committed=0/);
  assert.match(backup, /if \[ "\$pair_committed" != "1" \]; then/);
  assert.equal((backup.match(/pair_committed=1/g) ?? []).length, 1, "完整 pair 只能通过一次提交标记保留");
  assert.ok(backup.indexOf('final_dump="$dump_file"') < backup.indexOf('mv "$dump_partial" "$dump_file"'), "最终 dump 路径必须在发布前登记");
  assert.ok(backup.indexOf('final_sha="$sha_file"') < backup.indexOf('mv "$dump_partial" "$dump_file"'), "最终 sha 路径必须在发布前登记");
  assert.ok(backup.indexOf('pair_committed=1') > backup.indexOf('mv "$sha_partial" "$sha_file"'), "只能在两个最终文件发布后提交 pair");
  assert.ok(backup.indexOf('mv "$sha_partial" "$sha_file"') < backup.indexOf('mv "$dump_partial" "$dump_file"'), "checksum 必须先于 dump 成为最终文件");
  assert.doesNotMatch(backup, /cleanup_orphan_checksums/);
  assert.doesNotMatch(backup, /deleted-orphan-checksum/);
  assert.match(backup, /trap cleanup_uncommitted_partials_and_finals 0/);
  assert.match(backup, /trap abort_uncommitted_pair HUP INT TERM/);
  assert.match(backup, /abort_uncommitted_pair\(\)[\s\S]*exit 1/);

  assert.match(restore, /^#!\/bin\/sh\nset -eu/m);
  assert.match(restore, /BACKUP_FILE/);
  assert.match(restore, /\*\/*|\\\\/);
  assert.match(restore, /workbuddy-\[0-9\](?:\[0-9\]){7}-\[0-9\](?:\[0-9\]){5}\.dump/);
  assert.match(restore, /sha256sum -c/);
  assert.match(restore, /pg_restore --list/);
  assert.match(restore, /RESTORE_EXECUTE.*!=.*1/);
  assert.match(restore, /RESTORE_TARGET_ACK.*workbuddy_selfhost_uat/);
  assert.match(restore, /if \[ "\$PGDATABASE" != "workbuddy_selfhost_uat" \]; then/);
  assert.match(restore, /if \[ "\$\{RESTORE_TARGET_ACK:-\}" != "\$PGDATABASE" \]; then/);
  assert.match(restore, /pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --single-transaction/);
  assert.match(restore, /pg_isready -h "\$PGHOST" -p "\$PGPORT" -U "\$PGUSER" -d "\$PGDATABASE"/);
  assert.ok(restore.indexOf('pg_isready') > restore.indexOf('RESTORE_TARGET_ACK'), "dry-run 不得连接目标数据库");
  assert.ok(restore.indexOf('pg_isready') > restore.indexOf('PGDATABASE" != "workbuddy_selfhost_uat'), "覆盖的 PGDATABASE 必须在连接前被拒绝");
  assert.doesNotMatch(restore, /postgres(?:ql)?:\/\//i);

  const backupService = composeServiceBlock(compose, "backup");
  const restoreService = composeServiceBlock(compose, "restore");
  assert.match(backupService, /image: postgres:16/);
  assert.match(backupService, /user: "999:999"/);
  for (const key of ["PGHOST: db", "PGUSER: workbuddy_selfhost", "PGDATABASE: workbuddy_selfhost_uat", "PGPASSWORD:"]) {
    assert.match(backupService, new RegExp(key));
  }
  assert.match(backupService, /\.\/scripts\/selfhost-backup\.sh:\/scripts\/selfhost-backup\.sh:ro/);
  assert.match(backupService, /\.\/backups\/selfhost:\/backups/);
  assert.match(backupService, /networks: \[backend\]/);
  assert.match(backupService, /preflight:[\s\S]*db:[\s\S]*migrate:/);
  assert.match(backupService, /restart: unless-stopped/);
  assert.match(backupService, /logging: \*bounded-logging/);
  assert.match(backupService, /security_opt:|<<: \*restricted-security/);
  assert.match(backupService, /cap_drop:|<<: \*restricted-security/);
  assert.match(restoreService, /profiles: \["restore"\]/);
  assert.match(restoreService, /image: postgres:16/);
  assert.match(restoreService, /user: "999:999"/);
  assert.doesNotMatch(restoreService, /depends_on:/);
  assert.match(restoreService, /\.\/backups\/selfhost:\/backups:ro/);
  assert.match(restoreService, /networks: \[backend\]/);
  assert.match(restoreService, /RESTORE_EXECUTE: "0"/);
  assert.match(restoreService, /security_opt:|<<: \*restricted-security/);
  assert.match(restoreService, /cap_drop:|<<: \*restricted-security/);

  assert.match(attributes, /^\*\.sh text eol=lf$/m);
  const gitignore = readText(".gitignore");
  assert.match(gitignore, /^backups\/$/m);
  for (const phrase of ["down -v", "RESTORE_EXECUTE=1", "RESTORE_TARGET_ACK=workbuddy_selfhost_uat", "http://app:3000", "Cloudflare", "live", "ready"]) {
    assert.match(handbook, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(handbook, /恢复前备份/);
  assert.match(handbook, /stop tunnel app backup/);
  assert.match(handbook, /migration/);
  assert.match(handbook, /数据/);
  assert.match(handbook, /ACL/);
  assert.match(handbook, /icacls\.exe/);
  assert.match(handbook, /developers\.cloudflare\.com\/cloudflare-one\/networks\/connectors\/cloudflare-tunnel\/get-started\/create-remote-tunnel/);
  assert.match(composeWrapper, /\[System\.Environment\]::OSVersion\.Platform/);
  assert.doesNotMatch(composeWrapper, /icacls\.exe/);
  assert.match(composeWrapper, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(composeWrapper, /PurgeAccessRules/);
  assert.match(composeWrapper, /FileSystemAccessRule/);
  assert.match(composeWrapper, /Get-ChildItem -LiteralPath \$backupDirectory -Force -Recurse/);
  assert.match(composeWrapper, /Set-Acl/);
  assert.match(composeWrapper, /Get-Acl/);
  assert.match(composeWrapper, /AreAccessRulesProtected/);
  assert.match(composeWrapper, /AccessControlType.*Deny/);
  assert.match(composeWrapper, /allowedSidValues/);
  assert.match(composeWrapper, /S-1-5-18/);
  assert.match(composeWrapper, /S-1-5-32-544/);
  assert.match(composeWrapper, /WindowsIdentity.*GetCurrent/);
  assert.match(composeWrapper, /InheritanceFlags.*ObjectInherit.*ContainerInherit/);
  assert.match(handbook, /--force-recreate backup/);
  assert.match(handbook, /beforeBackupNames/);
  assert.match(handbook, /deadline/);
  assert.match(handbook, /Start-Sleep/);
  assert.match(handbook, /Test-Path.*sha256/);
  assert.doesNotMatch(handbook, /logs --tail 20 backup/);
});

test("Render Singapore UAT Blueprint 固定 PG16、迁移、健康检查和秘密边界", () => {
  const blueprint = readText("render.yaml");

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
