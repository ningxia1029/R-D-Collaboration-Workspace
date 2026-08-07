// 桌面端构建脚本（确定性手工流程，不依赖 electron-builder 的易卡复制）
// 流程：生成内置配置 → next build(standalone) → 手工组装绿色版 → NSIS 便携 exe + zip
// 用法：node scripts/build-desktop.mjs
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const distDir = path.join(root, "dist");
const unpackedDir = path.join(distDir, "win-unpacked");
const appDir = path.join(unpackedDir, "resources", "app");

function run(cmd, opts = {}) {
  console.log(">", cmd);
  execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
}
function cp(src, dst) {
  fs.cpSync(src, dst, { recursive: true, force: true });
  console.log("cp", src, "->", dst);
}

// 1) .env → desktop/builtin-env.json（含云端连接串；.gitignore 排除；放在 desktop/ 规避根目录只读问题）
console.log("\n== 1/6 生成内置运行配置 ==");
const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m) env[m[1]] = m[2].trim();
}
fs.rmSync(path.join(root, "desktop", "builtin-env.json"), { force: true }); // 覆盖写会被沙箱只读化，先删再写
fs.writeFileSync(
  path.join(root, "desktop", "builtin-env.json"),
  JSON.stringify({ databaseUrl: env.DATABASE_URL || "", authSecret: env.AUTH_SECRET || "", updateFeed: env.UPDATE_FEED || "" }, null, 2),
  "utf8"
);
console.log("desktop/builtin-env.json 已生成");

// 2) next build（standalone）
console.log("\n== 2/6 Next.js 生产构建（standalone）==");
run("node node_modules/next/dist/bin/next build");

// 3) 整理 standalone 静态资源
console.log("\n== 3/6 整理 standalone 产物 ==");
const standalone = path.join(root, ".next", "standalone");
cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"));
if (fs.existsSync(path.join(root, "public"))) cp(path.join(root, "public"), path.join(standalone, "public"));

// 4) 手工组装绿色版（确定性复制，规避沙箱下 electron-builder 复制卡死）
console.log("\n== 4/6 组装绿色版 win-unpacked ==");
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
cp(path.join(root, "node_modules", "electron", "dist"), unpackedDir);
fs.renameSync(path.join(unpackedDir, "electron.exe"), path.join(unpackedDir, "PLM-Workspace.exe"));
fs.mkdirSync(path.join(appDir, "desktop"), { recursive: true });
for (const f of ["main.js", "preload.js", "updater.js", "icon.ico", "builtin-env.json"]) cp(path.join(root, "desktop", f), path.join(appDir, "desktop", f));
for (const f of ["package.json"]) cp(path.join(root, f), path.join(appDir, f));
cp(standalone, path.join(appDir, ".next", "standalone"));

// 5) NSIS 便携单 exe
console.log("\n== 5/6 NSIS 便携单文件 exe ==");
const nsisScript = path.join(root, "scripts", "portable.nsi").replace(/\\/g, "/");
const outExe = `PLM平台-${version}-便携版.exe`;
const nsis = fs
  .readdirSync(path.join(root, "node_modules"))
  .includes("electron-builder") || true;
const makensisCandidates = [
  "C:/Users/Administrator/AppData/Local/electron-builder/Cache/nsis/nsis-3.0.4.1/Bin/makensis.exe",
  "C:/Users/Administrator/AppData/Local/electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-w8az6/Bin/makensis.exe",
];
const makensis = makensisCandidates.find((p) => fs.existsSync(p));
if (!makensis) throw new Error("未找到 makensis（NSIS 工具链），请先运行一次 electron-builder 下载 NSIS");
fs.writeFileSync(
  nsisScript,
  `Unicode true
Name "PLM研发协同平台"
OutFile "${outExe}"
InstallDir "$TEMP\\plm-workspace"
RequestExecutionLevel user
SetCompressor /SOLID lzma
XPStyle on
ShowInstDetails hide

Page instfiles

Section "Main"
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR"
  SetOverwrite on
  File /r "${unpackedDir.replace(/\\/g, "/")}\\*.*"
  Exec "$INSTDIR\\PLM-Workspace.exe"
SectionEnd
`,
  "utf8"
);
execSync(`"${makensis}" /INPUTCHARSET UTF8 "${nsisScript}"`, { cwd: path.join(root, "scripts"), stdio: "inherit" });
fs.renameSync(path.join(root, "scripts", outExe), path.join(distDir, outExe));

// 6) zip 绿色版
console.log("\n== 6/6 绿色版 zip ==");
const zipPath = path.join(distDir, `PLM平台-${version}-绿色版.zip`);
execSync(
  `"C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe" -c "` +
    `import zipfile,os;src=r'${unpackedDir}';out=r'${zipPath}';` +
    `z=zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6);` +
    `[z.write(os.path.join(r,f),os.path.join('PLM平台-绿色版',os.path.relpath(os.path.join(r,f),src))) for r,_,fs in os.walk(src) for f in fs];z.close();print('zip ok')"`,
  { stdio: "inherit" }
);

console.log(`\n✅ 打包完成：${outExe}（${(fs.statSync(path.join(distDir, outExe)).size / 1024 / 1024).toFixed(1)} MB）+ 绿色版 zip`);
