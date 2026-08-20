// 桌面端构建脚本（确定性手工流程，不依赖 electron-builder 的易卡复制）
// 流程：生成内置配置 → next build(standalone) → 手工组装绿色版 → NSIS 便携 exe + zip
// 用法：node scripts/build-desktop.mjs
import { execFileSync, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getMakeNsisPath } = require("app-builder-lib/out/toolsets/windows.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const distDir = process.env.PLM_BUILD_OUTPUT_DIR
  ? path.resolve(root, process.env.PLM_BUILD_OUTPUT_DIR)
  : path.join(root, "dist");
if (distDir !== path.join(root, "dist") && !distDir.startsWith(`${root}${path.sep}`)) {
  throw new Error("PLM_BUILD_OUTPUT_DIR 必须位于项目目录内");
}
const unpackedDir = path.join(distDir, "win-unpacked");
const appDir = path.join(unpackedDir, "resources", "app");
const outExe = `PLM-Workspace-v${version}-portable.exe`;
const outZip = `PLM-Workspace-v${version}-green.zip`;
const checksumPath = path.join(distDir, "SHA256SUMS.txt");
const provenancePath = path.join(distDir, "BUILD-PROVENANCE.json");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sourceDirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim() !== "";
const buildStartedAt = new Date().toISOString();
let buildSucceeded = false;

function cleanCurrentBuild(strict = true) {
  const errors = [];
  for (const target of [outExe, outZip, "SHA256SUMS.txt", "BUILD-PROVENANCE.json", ".portable-build.nsi"]) {
    try { fs.rmSync(path.join(distDir, target), { force: true }); } catch (error) { errors.push(error); }
  }
  try { fs.rmSync(unpackedDir, { recursive: true, force: true }); } catch (error) { errors.push(error); }
  if (strict && errors.length) throw new AggregateError(errors, "无法清理上一版构建产物；请先退出正在运行的客户端");
}

fs.mkdirSync(distDir, { recursive: true });
process.on("exit", () => {
  if (!buildSucceeded) cleanCurrentBuild(false);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cleanCurrentBuild(false);
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}
cleanCurrentBuild();

function run(cmd, opts = {}) {
  console.log(">", cmd);
  execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
}
function cp(src, dst) {
  fs.cpSync(src, dst, { recursive: true, force: true });
  console.log("cp", src, "->", dst);
}

// 1) 只注入公开配置。数据库连接串与认证密钥不得进入桌面产物。
console.log("\n== 1/6 生成安全运行配置 ==");
fs.rmSync(path.join(root, "desktop", "builtin-env.json"), { force: true }); // 覆盖写会被沙箱只读化，先删再写
fs.writeFileSync(
  path.join(root, "desktop", "builtin-env.json"),
  JSON.stringify({ serverUrl: process.env.PLM_SERVER_URL || "", updateFeed: process.env.PLM_UPDATE_FEED || "", allowLocalServer: false }, null, 2),
  "utf8"
);
console.log("desktop/builtin-env.json 已生成");

// 2) next build（standalone）
console.log("\n== 2/6 Next.js 生产构建（standalone）==");
run("node node_modules/next/dist/bin/next build");

// 3) 整理 standalone 静态资源
console.log("\n== 3/6 整理 standalone 产物 ==");
const standalone = path.join(root, ".next", "standalone");
// Next standalone 会复制项目根目录 .env；桌面产物严禁携带任何服务端环境文件。
for (const name of fs.readdirSync(standalone)) {
  if (name === ".env" || name.startsWith(".env.")) fs.rmSync(path.join(standalone, name), { force: true });
}
cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"));
if (fs.existsSync(path.join(root, "public"))) cp(path.join(root, "public"), path.join(standalone, "public"));

// 4) 手工组装绿色版（确定性复制，规避沙箱下 electron-builder 复制卡死）
console.log("\n== 4/6 组装绿色版 win-unpacked ==");
fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(unpackedDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
cp(path.join(root, "node_modules", "electron", "dist"), unpackedDir);
fs.renameSync(path.join(unpackedDir, "electron.exe"), path.join(unpackedDir, "PLM-Workspace.exe"));
fs.mkdirSync(path.join(appDir, "desktop"), { recursive: true });
for (const f of ["main.js", "preload.js", "config-preload.js", "config.html", "updater.js", "icon.ico", "builtin-env.json"]) cp(path.join(root, "desktop", f), path.join(appDir, "desktop", f));
for (const f of ["package.json"]) cp(path.join(root, f), path.join(appDir, f));
cp(standalone, path.join(appDir, ".next", "standalone"));

// 在生成 exe/zip 前完成密钥门禁，失败时不会遗留新的不可信发布资产。
const leakedEnv = [];
function findEnvFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findEnvFiles(full);
    else if (entry.name === ".env" || entry.name.startsWith(".env.")) leakedEnv.push(full);
  }
}
findEnvFiles(appDir);
if (leakedEnv.length) throw new Error(`产物包含环境文件：${leakedEnv.join(", ")}`);
const publicConfig = JSON.parse(fs.readFileSync(path.join(appDir, "desktop", "builtin-env.json"), "utf8"));
if ("databaseUrl" in publicConfig || "authSecret" in publicConfig) throw new Error("产物公开配置包含禁止的服务端密钥字段");

function envFileValue(key) {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`));
    if (!match) continue;
    const raw = match[1].trim();
    return raw.replace(/^(['"])(.*)\1$/, "$2");
  }
  return "";
}

const secretValues = [
  process.env.DATABASE_URL || envFileValue("DATABASE_URL"),
  process.env.AUTH_SECRET || envFileValue("AUTH_SECRET"),
].filter((value) => value.length >= 8);
function scanSecretValues(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scanSecretValues(full);
    else {
      const content = fs.readFileSync(full);
      if (secretValues.some((value) => content.includes(Buffer.from(value)))) {
        throw new Error(`产物文件包含服务端秘密值：${path.relative(appDir, full)}`);
      }
    }
  }
}
if (secretValues.length) scanSecretValues(appDir);

let codeSigned = false;
let signingCertificateSubject = null;
const signingValues = [
  process.env.PLM_SIGNTOOL_PATH,
  process.env.PLM_SIGNING_CERT_SUBJECT,
  process.env.PLM_SIGNING_CERT_SHA1,
];
const signingReady = signingValues.every(Boolean);
if (signingValues.some(Boolean) && !signingReady) {
  throw new Error("桌面签名配置不完整，必须同时提供 PLM_SIGNTOOL_PATH、PLM_SIGNING_CERT_SUBJECT 与 PLM_SIGNING_CERT_SHA1");
}
if (signingReady && process.platform !== "win32") throw new Error("桌面 Authenticode 签名只能在 Windows 构建节点执行");
if (signingReady && !/^[a-fA-F0-9]{40}$/.test(process.env.PLM_SIGNING_CERT_SHA1)) {
  throw new Error("PLM_SIGNING_CERT_SHA1 必须是 40 位证书指纹");
}
const signedExecutables = [];
function signAndVerify(target) {
  execFileSync(process.env.PLM_SIGNTOOL_PATH, [
    "sign", "/sha1", process.env.PLM_SIGNING_CERT_SHA1, "/fd", "SHA256", "/tr", "http://timestamp.digicert.com", "/td", "SHA256", target,
  ], { cwd: root, stdio: "inherit" });
  execFileSync(process.env.PLM_SIGNTOOL_PATH, ["verify", "/pa", "/all", target], { cwd: root, stdio: "inherit" });
}

// 绿色版和便携包都包含此主程序，因此必须在归档前完成签名。
if (signingReady) {
  signAndVerify(path.join(unpackedDir, "PLM-Workspace.exe"));
  signedExecutables.push("win-unpacked/PLM-Workspace.exe");
}

// 5) NSIS 便携单 exe
console.log("\n== 5/6 NSIS 便携单文件 exe ==");
const nsisScript = path.join(distDir, ".portable-build.nsi");
const cachedMakeNsis = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "electron-builder", "Cache", "nsis", "nsis-3.0.4.1", "Bin", "makensis.exe")
  : "";
// 已缓存工具链直接使用；全新 CI Runner 则由 electron-builder 的校验下载器自举。
const makensis = cachedMakeNsis && fs.existsSync(cachedMakeNsis)
  ? { path: cachedMakeNsis, env: { NSISDIR: path.dirname(path.dirname(cachedMakeNsis)) } }
  : await getMakeNsisPath(undefined, undefined);
fs.writeFileSync(
  nsisScript,
  `Unicode true
!include "MUI2.nsh"
Name "PLM研发协同平台"
Caption "PLM研发协同平台 v${version} 便携版"
OutFile "${path.join(distDir, outExe).replace(/\\/g, "/")}"
InstallDir "$TEMP\\plm-workspace\\v${version}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
XPStyle on
ShowInstDetails hide
AutoCloseWindow true

!define MUI_WELCOMEPAGE_TITLE "运行 PLM研发协同平台便携版"
!define MUI_WELCOMEPAGE_TEXT "这是便携启动包，不会安装到系统，也不会创建卸载项。$\\r$\\n$\\r$\\n点击“下一步”后将解压约 100 MB 文件；解压期间为避免文件损坏，取消和关闭按钮会暂时禁用。您现在可以点击“取消”安全退出。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Main"
  SetOutPath "$TEMP"
  ClearErrors
  RMDir /r "$INSTDIR"
  IfErrors extraction_failed
  SetOverwrite on
  SetOutPath "$INSTDIR"
  File /r "${unpackedDir.replace(/\\/g, "/")}\\*.*"
  Exec "$INSTDIR\\PLM-Workspace.exe"
  Goto extraction_done
extraction_failed:
  MessageBox MB_ICONSTOP "无法更新临时文件。请先从系统托盘退出正在运行的 PLM 版本后重试。"
  Abort
extraction_done:
SectionEnd
`,
  "utf8"
);
fs.rmSync(path.join(distDir, outExe), { force: true });
try {
  execFileSync(makensis.path, ["/INPUTCHARSET", "UTF8", nsisScript], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...(makensis.env || {}) },
  });
} finally {
  fs.rmSync(nsisScript, { force: true });
}

// 6) zip 绿色版
console.log("\n== 6/6 绿色版 zip ==");
const zipPath = path.join(distDir, outZip);
fs.rmSync(zipPath, { force: true });
execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -LiteralPath '${unpackedDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`,
], { cwd: root, stdio: "inherit" });

if (signingReady) {
  signAndVerify(path.join(distDir, outExe));
  signedExecutables.push(outExe);
  codeSigned = true;
  signingCertificateSubject = process.env.PLM_SIGNING_CERT_SUBJECT;
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const checksumLines = [outExe, path.basename(zipPath)].map((name) => `${sha256(path.join(distDir, name))}  ${name}`);
fs.writeFileSync(path.join(distDir, "SHA256SUMS.txt"), checksumLines.join("\n") + "\n", "utf8");

const artifactHashes = Object.fromEntries(checksumLines.map((line) => {
  const [hash, name] = line.split(/\s+/, 2);
  return [name, hash];
}));
fs.writeFileSync(provenancePath, JSON.stringify({
  version,
  sourceCommit,
  sourceDirty,
  buildStartedAt,
  builtAt: new Date().toISOString(),
  codeSigned,
  signingCertificateSubject,
  signedExecutables,
  artifacts: artifactHashes,
}, null, 2) + "\n", "utf8");
buildSucceeded = true;

console.log(`\n✅ 打包完成：${outExe}（${(fs.statSync(path.join(distDir, outExe)).size / 1024 / 1024).toFixed(1)} MB）+ 绿色版 zip + provenance`);
