import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("阶段 8 CI 固定 Node 24、PostgreSQL 16 与完整质量/恢复门禁", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  for (const required of [
    "node-version: 24.12.0",
    "image: postgres:16",
    "npm audit --audit-level=high",
    "npm run agent:eval",
    "npm run agent:benchmark",
    "npm run test:e2e",
    "npx prisma migrate deploy",
    "pg_dump --format=custom",
    "pg_restore --no-owner",
    "npm run build:desktop",
  ]) {
    assert.ok(workflow.includes(required), `CI 缺少门禁：${required}`);
  }
});

test("恢复演练审批夹具按运行时间生成未来过期值", async () => {
  const restoreFixture = await readFile("scripts/verify-agent-restore-db.ts", "utf8");
  assert.match(restoreFixture, /const approvalCreatedAt = new Date\(\)/);
  assert.match(restoreFixture, /expiresAt:\s*new Date\(approvalCreatedAt\.getTime\(\) \+ 60 \* 60 \* 1000\)/);
  assert.doesNotMatch(restoreFixture, /expiresAt:\s*new Date\("\d{4}-\d{2}-\d{2}/);
});

test("正式发布同时要求干净提交、哈希一致和真实代码签名 provenance", async () => {
  const [releaseScript, desktopBuild] = await Promise.all([
    readFile("scripts/release.mjs", "utf8"),
    readFile("scripts/build-desktop.mjs", "utf8"),
  ]);
  assert.match(releaseScript, /工作树不干净，禁止发布/);
  assert.match(releaseScript, /provenance\.sourceCommit !== head/);
  assert.match(releaseScript, /provenance\.codeSigned !== true/);
  assert.match(releaseScript, /requiredSignedExecutables/);
  assert.match(releaseScript, /provenance\.artifacts\?\.\[name\] !== actual/);
  assert.match(desktopBuild, /codeSigned = false/);
  assert.match(desktopBuild, /signingCertificateSubject = null/);
  assert.match(desktopBuild, /PLM_SIGNING_CERT_SHA1/);
  assert.match(desktopBuild, /getMakeNsisPath/);
  assert.match(desktopBuild, /signedExecutables\.push\("win-unpacked\/PLM-Workspace\.exe"\)/);
  assert.match(desktopBuild, /signedExecutables\.push\(outExe\)/);
  assert.ok(
    desktopBuild.indexOf('signAndVerify(path.join(unpackedDir, "PLM-Workspace.exe"))') < desktopBuild.indexOf("== 5/6 NSIS"),
    "绿色版主程序必须在 NSIS 与 zip 归档前签名",
  );
});

test("生产登录默认不展示或预填演示凭据", async () => {
  const loginPage = await readFile("src/app/(auth)/login/page.tsx", "utf8");
  assert.match(loginPage, /NEXT_PUBLIC_DEMO_MODE === "true"/);
  assert.match(loginPage, /initialValues=\{DEMO_MODE \?/);
  assert.match(loginPage, /\{DEMO_MODE && \(/);
});

test("Agent 保留清理默认 dry-run，执行需数据库名和精确数量双确认", async () => {
  const sweep = await readFile("scripts/agent-retention-sweep.ts", "utf8");
  assert.match(sweep, /process\.argv\.includes\("--apply"\)/);
  assert.match(sweep, /AGENT_RETENTION_TARGET_ACK/);
  assert.match(sweep, /DELETE \$\{candidates\.length\} EXPIRED AGENT RUNS/);
  assert.match(sweep, /\["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"\]/);
  assert.doesNotMatch(sweep, /db push|seed/i);
});

test("桌面端仅接受 HTTPS 服务器并保持上下文隔离、沙箱和导航源限制", async () => {
  const desktopMain = await readFile("desktop/main.js", "utf8");
  assert.match(desktopMain, /parsed\.protocol !== "https:"/);
  assert.match(desktopMain, /contextIsolation: true/);
  assert.match(desktopMain, /nodeIntegration: false/);
  assert.match(desktopMain, /sandbox: true/);
  assert.match(desktopMain, /new URL\(target\)\.origin !== allowedOrigin/);
});

test("Worker 为 DeepSeek 真实验收显式配置非思考、输出上限和定价快照", async () => {
  const workerCli = await readFile("agent-worker/src/cli.ts", "utf8");
  assert.match(workerCli, /AGENT_MODEL_THINKING/);
  assert.match(workerCli, /AGENT_MODEL_MAX_OUTPUT_TOKENS/);
  assert.match(workerCli, /cacheHitInputUsdPerMillion/);
  assert.match(workerCli, /deepseek-v4-flash/);
});

test("真实模型评测命令先做模型预检并限制次数、成本与脱敏报告边界", async () => {
  const [packageJson, liveRunner] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("scripts/run-agent-live-eval.ts", "utf8").catch(() => ""),
  ]);
  assert.match(packageJson, /"agent:eval:live"\s*:/);
  assert.match(liveRunner, /\/models/);
  assert.match(liveRunner, /AGENT_MODEL_API_KEY/);
  assert.match(liveRunner, /LIVE_AGENT_EVAL_MAX_COST_MICROS/);
  assert.match(liveRunner, /ENTERPRISE_AGENT_LIVE_SMOKE_CASE_IDS/);
  assert.match(liveRunner, /enterprise-agent-live-deepseek-v4-flash-smoke\.json/);
  assert.match(liveRunner, /enterprise-agent-live-deepseek-v4-flash-full\.json/);
  assert.doesNotMatch(liveRunner, /console\.(?:log|error)\([^\n]*apiKey/);
});

test("Prisma 控制面把 scopeJson 中的可信项目上下文传给 Worker", async () => {
  const controlPlane = await readFile("src/lib/agent/runtime/prismaControlPlane.ts", "utf8");
  assert.match(controlPlane, /contextProjectId/);
  assert.match(controlPlane, /scopeJson/);
});
