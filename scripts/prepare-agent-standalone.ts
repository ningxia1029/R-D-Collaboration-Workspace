import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = path.join(root, ".next");
const standaloneDir = path.join(nextDir, "standalone");
if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
  throw new Error("缺少 .next/standalone/server.js，请先执行 npm run build");
}

for (const name of fs.readdirSync(standaloneDir)) {
  if (name === ".env" || name.startsWith(".env.")) {
    fs.rmSync(path.join(standaloneDir, name), { force: true });
  }
}

fs.cpSync(path.join(nextDir, "static"), path.join(standaloneDir, ".next", "static"), {
  recursive: true,
  force: true,
});
const publicDir = path.join(root, "public");
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, path.join(standaloneDir, "public"), { recursive: true, force: true });
}

const leakedEnvironmentFiles: string[] = [];
function findEnvironmentFiles(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) findEnvironmentFiles(fullPath);
    else if (entry.name === ".env" || entry.name.startsWith(".env.")) leakedEnvironmentFiles.push(fullPath);
  }
}
findEnvironmentFiles(standaloneDir);
if (leakedEnvironmentFiles.length > 0) {
  throw new Error(`standalone 产物包含环境文件：${leakedEnvironmentFiles.join(", ")}`);
}

console.log(`[standalone] prepared=${standaloneDir}`);
console.log("[standalone] environment_files=0");
