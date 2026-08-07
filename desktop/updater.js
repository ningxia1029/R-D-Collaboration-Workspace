// 在线更新服务（阶段3：GitHub Releases + portable 替换式更新器）
// portable exe 无法原地替换自身：下载新 exe → 提示重启 → 用 updater.cmd 等待进程退出后替换并重启
"use strict";

const { app, dialog, Notification, shell } = require("electron");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const API = "https://api.github.com/repos/ningxia1029/R-D-Collaboration-Workspace/releases/latest";

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "plm-workspace-updater", Accept: "application/vnd.github+json", ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
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
      const feedUrl = cfg.updateFeed || API;
      const rel = await fetchJson(feedUrl);
      const tag = (rel.tag_name || "").replace(/^v/, "");
      const current = app.getVersion();
      const need = compareVersions(tag, current) > 0;
      state.latest = { tag, name: rel.name || tag, assets: rel.assets || [] };
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
    const asset = (state.latest.assets || []).find((a) => /\.exe$/i.test(a.name));
    if (!asset) { dialog.showErrorBox(app.getName(), "发布包中未找到可执行文件"); return; }
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

      // 国内加速：优先 ghproxy 镜像
      const mirrors = [
        asset.browser_download_url,
        asset.browser_download_url.replace("https://github.com", "https://ghproxy.net/https://github.com"),
        asset.browser_download_url.replace("https://github.com", "https://mirror.ghproxy.com/https://github.com"),
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
