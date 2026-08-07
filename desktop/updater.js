// 在线更新服务（GitHub Releases + portable 替换式更新器）
// 检测：GET /releases/latest 跟随 302 重定向解析最新 tag（不依赖 GitHub API，规避匿名限流）
// 更新：下载新 exe → 提示重启 → updater.cmd 等待本进程退出后覆盖自身并重启
"use strict";

const { app, dialog } = require("electron");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const REPO = "ningxia1029/R-D-Collaboration-Workspace";
const LATEST_URL = `https://github.com/${REPO}/releases/latest`;
const ASSET_PATTERN = (tag) => `PLM-Workspace-v${tag}-portable.exe`;

// 跟随重定向解析最终 URL（用于取最新 tag）
function resolveRedirect(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("重定向过多"));
    const req = https.get(url, { headers: { "User-Agent": "plm-workspace-updater" }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(resolveRedirect(next, redirects + 1));
      }
      res.resume();
      resolve({ finalUrl: url, statusCode: res.statusCode });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("请求超时")));
  });
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { "User-Agent": "plm-workspace-updater" } }, (res) => {
      if (res.statusCode >= 400) { reject(new Error("下载失败 HTTP " + res.statusCode)); res.resume(); return; }
      const total = parseInt(res.headers["content-length"] || "0", 10);
      let got = 0;
      res.on("data", (c) => { got += c.length; onProgress?.(got, total); });
      res.pipe(file);
    });
    file.on("finish", () => { file.close(); resolve(dest); });
    req.on("error", (e) => { fs.unlink(dest, () => {}); reject(e); });
    req.setTimeout(120000, () => req.destroy(new Error("下载超时")));
  });
}

function compareVersions(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

module.exports = function registerUpdater({ app, mainWindow, cfg }) {
  let checking = false;
  const state = { latest: null, downloading: false };

  async function check() {
    if (checking) return { ok: false, message: "正在检查中" };
    checking = true;
    try {
      const feedUrl = cfg.updateFeed || LATEST_URL;
      const { finalUrl, statusCode } = await resolveRedirect(feedUrl);
      if (statusCode >= 400) throw new Error("HTTP " + statusCode);
      const m = finalUrl.match(/\/releases\/tag\/(v?[\d.]+)/);
      if (!m) throw new Error("无法解析最新版本");
      const tag = m[1].replace(/^v/, "");
      const current = app.getVersion();
      const need = compareVersions(tag, current) > 0;
      state.latest = { tag, assetName: ASSET_PATTERN(tag) };
      if (!need) return { ok: true, needUpdate: false, message: `已是最新版本 v${current}` };
      return { ok: true, needUpdate: true, message: `发现新版本 v${tag}`, latest: state.latest };
    } catch (e) {
      return { ok: false, message: "检查更新失败：" + e.message };
    } finally {
      checking = false;
    }
  }

  // 更新流程：下载 → 确认 → updater.cmd 替换重启
  async function doUpdate(parent) {
    const latest = state.latest;
    if (!latest) {
      const r = await check();
      if (!r.needUpdate) { dialog.showMessageBox(parent, { type: "info", message: r.message }); return; }
    }
    const assetUrl = `https://github.com/${REPO}/releases/latest/download/${latest.assetName}`;
    if (state.downloading) return;
    state.downloading = true;

    const dlPath = path.join(app.getPath("temp"), `plm-update-${Date.now()}.exe`);
    const win = mainWindow || parent;
    try {
      const r = await dialog.showMessageBox(win, {
        type: "info",
        title: "发现新版本",
        message: `新版本 v${state.latest.tag} 已发布`,
        detail: "点击「下载并更新」，下载完成后将自动重启完成替换。",
        buttons: ["下载并更新", "稍后"],
        defaultId: 0,
        cancelId: 1,
      });
      if (r.response !== 0) { state.downloading = false; return; }

      // 国内加速：直连优先 + ghproxy 镜像
      const mirrors = [
        assetUrl,
        assetUrl.replace("https://github.com", "https://ghproxy.net/https://github.com"),
        assetUrl.replace("https://github.com", "https://mirror.ghproxy.com/https://github.com"),
      ];
      let done = false;
      for (const url of mirrors) {
        try {
          await download(url, dlPath, (got, total) => {
            win.setProgressBar(total ? got / total : -1);
          });
          done = true;
          break;
        } catch (e) {
          console.warn("下载失败，尝试镜像:", e.message);
        }
      }
      win.setProgressBar(-1);
      if (!done) { dialog.showErrorBox(app.getName(), "下载失败，请检查网络后重试"); state.downloading = false; return; }

      // 写入替换脚本：等待本进程退出 → 覆盖 exe → 重启
      const updaterCmd = path.join(app.getPath("temp"), "plm-updater.cmd");
      const selfExe = process.execPath;
      const cmd = [
        "@echo off",
        ":wait",
        'tasklist /FI "PID eq ' + process.pid + '" | findstr "' + process.pid + '" >nul',
        "if not errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait)",
        'copy /Y "' + dlPath + '" "' + selfExe + '" >nul',
        'if errorlevel 1 (echo 替换失败:请手动运行新版本 & pause & exit /b 1)',
        'del /Q "' + dlPath + '" >nul 2>nul',
        'start "" "' + selfExe + '"',
        "exit",
      ].join("\r\n");
      fs.writeFileSync(updaterCmd, cmd, "utf8");
      spawn("cmd.exe", ["/c", updaterCmd], { detached: true, stdio: "ignore", windowsHide: true }).unref();

      app.isQuitting = true;
      app.exit(0);
    } catch (e) {
      state.downloading = false;
      dialog.showErrorBox(app.getName(), "更新失败：" + e.message);
    }
  }

  return {
    check,
    update: () => doUpdate(mainWindow),
  };
};
