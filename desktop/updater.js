// 安全更新服务：检查 GitHub Release，校验 SHA-256 后下载新便携包。
// 便携包运行时执行的是临时目录中的内部 exe，因此不再尝试原地覆盖。
"use strict";

const { dialog, shell } = require("electron");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = "ningxia1029/R-D-Collaboration-Workspace";
const LATEST_URL = `https://github.com/${REPO}/releases/latest`;
const ASSET_PATTERN = (tag) => `PLM-Workspace-v${tag}-portable.exe`;
const CHECKSUM_ASSET = "SHA256SUMS.txt";

function request(url, onResponse, redirects = 0) {
  if (redirects > 8) return Promise.reject(new Error("重定向过多"));
  if (new URL(url).protocol !== "https:") return Promise.reject(new Error("更新请求只允许 HTTPS"));
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "plm-workspace-updater" }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        resolve(request(next, onResponse, redirects + 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      resolve(onResponse(res, url));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("请求超时")));
  });
}

async function resolveRedirect(url) {
  return request(url, (res, finalUrl) => {
    res.resume();
    return finalUrl;
  });
}

async function fetchText(url) {
  return request(url, (res) => new Promise((resolve, reject) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => resolve(body));
    res.on("error", reject);
  }));
}

async function download(url, dest, onProgress) {
  const temp = `${dest}.part`;
  await fs.promises.rm(temp, { force: true });
  try {
    await request(url, (res) => new Promise((resolve, reject) => {
      const file = fs.createWriteStream(temp, { flags: "wx" });
      const total = Number(res.headers["content-length"] || 0);
      let received = 0;
      res.on("data", (chunk) => {
        received += chunk.length;
        onProgress?.(received, total);
      });
      res.on("error", reject);
      file.on("error", reject);
      file.on("finish", resolve);
      res.pipe(file);
    }));
    await fs.promises.rm(dest, { force: true });
    await fs.promises.rename(temp, dest);
    return dest;
  } catch (error) {
    await fs.promises.rm(temp, { force: true });
    throw error;
  }
}

function compareVersions(a, b) {
  const parse = (v) => v.replace(/^v/, "").split(".").map((n) => Number(n));
  const pa = parse(a);
  const pb = parse(b);
  if ([...pa, ...pb].some(Number.isNaN)) throw new Error("版本号格式无效");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function expectedHash(manifest, assetName) {
  for (const line of manifest.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match && match[2] === assetName) return match[1].toLowerCase();
  }
  throw new Error(`校验清单中没有 ${assetName}`);
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", resolve);
    input.on("error", reject);
  });
  return hash.digest("hex");
}

function registerUpdater({ app, mainWindow, cfg }) {
  let checking = false;
  let latest = null;

  async function check() {
    if (checking) return { ok: false, message: "正在检查中" };
    checking = true;
    try {
      const finalUrl = await resolveRedirect(cfg.updateFeed || LATEST_URL);
      const match = finalUrl.match(/\/releases\/tag\/(v?[0-9]+(?:\.[0-9]+){1,3})/);
      if (!match) throw new Error("无法解析最新版本");
      const tag = match[1].replace(/^v/, "");
      const current = app.getVersion();
      latest = { tag, assetName: ASSET_PATTERN(tag) };
      return compareVersions(tag, current) > 0
        ? { ok: true, needUpdate: true, message: `发现新版本 v${tag}`, latest }
        : { ok: true, needUpdate: false, message: `已是最新版本 v${current}` };
    } catch (error) {
      return { ok: false, message: `检查更新失败：${error.message}` };
    } finally {
      checking = false;
    }
  }

  async function downloadLatest() {
    if (!latest) throw new Error("尚未取得最新版本信息");
    const releaseBase = `https://github.com/${REPO}/releases/download/v${latest.tag}`;
    const manifest = await fetchText(`${releaseBase}/${CHECKSUM_ASSET}`);
    const wantedHash = expectedHash(manifest, latest.assetName);
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: `保存 PLM v${latest.tag}`,
      defaultPath: path.join(app.getPath("downloads"), latest.assetName),
      filters: [{ name: "Windows 应用", extensions: ["exe"] }],
    });
    if (choice.canceled || !choice.filePath) return { ok: true, canceled: true };
    await download(`${releaseBase}/${latest.assetName}`, choice.filePath, (received, total) => {
      mainWindow?.setProgressBar(total ? received / total : -1);
    });
    mainWindow?.setProgressBar(-1);
    const actualHash = await sha256(choice.filePath);
    if (actualHash !== wantedHash) {
      await fs.promises.rm(choice.filePath, { force: true });
      throw new Error("下载文件 SHA-256 校验失败，已删除不可信文件");
    }
    shell.showItemInFolder(choice.filePath);
    return { ok: true, path: choice.filePath, sha256: actualHash };
  }

  async function checkAndPrompt(options = {}) {
    const result = await check();
    if (!result.ok || !result.needUpdate) {
      if (!options.silentWhenCurrent || !result.ok) {
        await dialog.showMessageBox(mainWindow, { type: result.ok ? "info" : "warning", message: result.message });
      }
      return result;
    }
    const answer = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "发现新版本",
      message: result.message,
      detail: "新版本将从官方 GitHub Release 下载，并在 SHA-256 校验通过后保存。请先从系统托盘菜单选择“退出”，再启动新文件。",
      buttons: ["下载并校验", "稍后"],
      defaultId: 0,
      cancelId: 1,
    });
    if (answer.response !== 0) return { ...result, canceled: true };
    try {
      return { ...result, download: await downloadLatest() };
    } catch (error) {
      mainWindow?.setProgressBar(-1);
      dialog.showErrorBox(app.getName(), `更新下载失败：${error.message}`);
      return { ok: false, message: error.message };
    }
  }

  return { check, checkAndPrompt, downloadLatest };
}

module.exports = { registerUpdater, compareVersions, expectedHash };
