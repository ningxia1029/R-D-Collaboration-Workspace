// 桌面端构建脚本：生成内置配置 → next build(standalone) → 整理产物 → electron-builder 打包 portable exe
// 用法：node scripts/build-desktop.mjs
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cwd = root;

function run(cmd, opts = {}) {
  console.log(">", cmd);
  execSync(cmd, { cwd, stdio: "inherit", ...opts });
}

// 1) 解析 .env → builtin-env.json（随 exe 分发；.gitignore 排除不入库）
console.log("\n== 1/4 生成内置运行配置 ==");
const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
const parseEnv = (t) => {
  const out = {};
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
};
const env = parseEnv(envText);
const builtin = {
  databaseUrl: env.DATABASE_URL || "",
  authSecret: env.AUTH_SECRET || "",
  updateFeed: env.UPDATE_FEED || "",
};
fs.writeFileSync(
  path.join(root, "builtin-env.json"),
  JSON.stringify(builtin, null, 2),
  "utf8"
);
console.log("builtin-env.json 已生成（含云端连接串，勿提交到 git）");

// 2) next build（standalone 输出）
console.log("\n== 2/4 Next.js 生产构建（standalone）==");
run("npx next build");

// 3) 补齐 standalone 静态资源（Next 官方要求：.next/static → standalone/.next/static）
console.log("\n== 3/4 整理 standalone 产物 ==");
const standalone = path.join(root, ".next", "standalone");
const srcStatic = path.join(root, ".next", "static");
const dstStatic = path.join(standalone, ".next", "static");
fs.cpSync(srcStatic, dstStatic, { recursive: true });
// public 资源（如有）
if (fs.existsSync(path.join(root, "public"))) {
  fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
}
// 复制 Electron 壳文件到 standalone 同级（打包 files 引用根路径，无需复制）
console.log("standalone 产物就绪");

// 4) electron-builder 打包 portable exe
console.log("\n== 4/4 electron-builder 打包 portable exe ==");
run("npx electron-builder --win portable --config desktop/electron-builder.yml");

console.log("\n✅ 打包完成，产物在 release/ 目录");
