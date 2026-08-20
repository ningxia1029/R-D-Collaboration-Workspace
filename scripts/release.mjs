// 发布脚本：把打包产物发布到 GitHub Releases（用于应用内在线更新）
// 用法：node scripts/release.mjs [version]  （默认取 package.json 版本）
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = process.argv[2] || pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`非法版本号: ${version}`);

const releaseDir = path.join(root, "dist");
const expectedArtifacts = [
  `PLM-Workspace-v${version}-portable.exe`,
  `PLM-Workspace-v${version}-green.zip`,
  "SHA256SUMS.txt",
  "BUILD-PROVENANCE.json",
];
const artifacts = fs
  .readdirSync(releaseDir)
  .filter((f) => expectedArtifacts.includes(f));
const missing = expectedArtifacts.filter((name) => !artifacts.includes(name));
if (missing.length) throw new Error(`缺少发布产物：${missing.join(", ")}`);
const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim();
if (status) throw new Error("工作树不干净，禁止发布；请先完成评审并提交全部源码变更");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const provenance = JSON.parse(fs.readFileSync(path.join(releaseDir, "BUILD-PROVENANCE.json"), "utf8"));
if (provenance.version !== version) throw new Error("构建 provenance 版本与发布版本不一致");
if (provenance.sourceCommit !== head) throw new Error("构建产物不是由当前 HEAD 生成，禁止发布陈旧资产");
if (provenance.sourceDirty !== false) throw new Error("构建产物来自脏工作树，禁止正式发布；请在提交后重新打包");
if (provenance.codeSigned !== true || !provenance.signingCertificateSubject) {
  throw new Error("构建 provenance 缺少有效代码签名证据，禁止正式发布");
}
const requiredSignedExecutables = ["win-unpacked/PLM-Workspace.exe", `PLM-Workspace-v${version}-portable.exe`];
if (!Array.isArray(provenance.signedExecutables) || requiredSignedExecutables.some((name) => !provenance.signedExecutables.includes(name))) {
  throw new Error("构建 provenance 未证明绿色版主程序和便携外层程序均已签名，禁止正式发布");
}

const manifest = fs.readFileSync(path.join(releaseDir, "SHA256SUMS.txt"), "utf8");
for (const name of expectedArtifacts.filter((item) => !["SHA256SUMS.txt", "BUILD-PROVENANCE.json"].includes(item))) {
  const expected = manifest.split(/\r?\n/).map((line) => line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)).find((match) => match?.[2] === name)?.[1]?.toLowerCase();
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(releaseDir, name))).digest("hex");
  if (!expected || expected !== actual) throw new Error(`${name} 的 SHA-256 与清单不一致`);
  if (provenance.artifacts?.[name] !== actual) throw new Error(`${name} 的 SHA-256 与构建 provenance 不一致`);
}
console.log(
  `发布 v${version}：` +
    artifacts.map((f) => `${f}（${(fs.statSync(path.join(releaseDir, f)).size / 1024 / 1024).toFixed(1)} MB）`).join(" + ")
);

const tag = `v${version}`;
const notes = [
  `# PLM 研发协同平台 v${version}`,
  "",
  "免安装便携版（双击即用，数据存云端 Neon PostgreSQL）。",
  "",
  "## 本版本内容",
  "- PLM：产品结构树 / 物料库 / 版本历史 / 生命周期阶段机 / ECR→ECO 变更流",
  "- 项目管理：WBS / 看板 / 甘特图 / 工时负载 / 里程碑",
  "- 工程知识库：版本历史 / 全文检索 / Markdown+Mermaid",
  "- RBAC 权限 + 项目级数据权限",
  "- 应用内在线更新（启动时自动检查）",
].join("\n");

const tmpNotes = path.join(os.tmpdir(), `plm-release-notes-${process.pid}.md`);
fs.writeFileSync(tmpNotes, notes, "utf8");

const artifactPaths = artifacts.map((f) => path.join(releaseDir, f));
try {
  let tagCommit = "";
  try {
    tagCommit = execFileSync("git", ["rev-list", "-n", "1", tag], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { /* tag 不存在 */ }
  if (tagCommit && tagCommit !== head) throw new Error(`${tag} 已指向其他提交 ${tagCommit}，禁止复用版本号`);
  if (!tagCommit) {
    execFileSync("git", ["tag", tag], { cwd: root, stdio: "pipe" });
    console.log("已打 tag", tag);
  } else {
    console.log("tag 已存在且与当前提交一致");
  }

  execFileSync("git", ["push", "origin", tag], { cwd: root, stdio: "pipe" });
  console.log("tag 已推送");

  execFileSync("gh", ["release", "create", tag, ...artifactPaths, "--title", `PLM 研发协同平台 v${version}`, "--notes-file", tmpNotes], {
    cwd: root,
    stdio: "inherit",
  });
} finally {
  fs.rmSync(tmpNotes, { force: true });
}
console.log(`✅ 已发布：https://github.com/ningxia1029/R-D-Collaboration-Workspace/releases/tag/${tag}`);
