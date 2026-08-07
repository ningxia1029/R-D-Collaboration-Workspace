// 发布脚本：把打包产物发布到 GitHub Releases（用于应用内在线更新）
// 用法：node scripts/release.mjs [version]  （默认取 package.json 版本）
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = process.argv[2] || pkg.version;

const releaseDir = path.join(root, "dist");
const artifacts = fs
  .readdirSync(releaseDir)
  .filter((f) => (f.endsWith(".exe") || f.endsWith(".zip")) && !f.includes("unpacked"));
if (artifacts.length === 0) {
  console.error("❌ 未找到打包产物，请先运行 npm run build:desktop");
  process.exit(1);
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

const tmpNotes = path.join(root, ".release-notes.md");
fs.writeFileSync(tmpNotes, notes, "utf8");

try {
  execSync(`git tag ${tag}`, { cwd: root, stdio: "pipe" });
  console.log("已打 tag", tag);
} catch { console.log("tag 已存在，跳过"); }

execSync(`git push origin ${tag}`, { cwd: root, stdio: "pipe" });
console.log("tag 已推送");

const artifactPaths = artifacts.map((f) => path.join(releaseDir, f)).join('" "');
execSync(
  `gh release create ${tag} "${artifactPaths}" --title "PLM 研发协同平台 v${version}" --notes-file "${tmpNotes}"`,
  { cwd: root, stdio: "inherit" }
);
fs.unlinkSync(tmpNotes);
console.log(`✅ 已发布：https://github.com/ningxia1029/R-D-Collaboration-Workspace/releases/tag/${tag}`);
