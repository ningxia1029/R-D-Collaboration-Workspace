// PLM 研发协同平台 —— Electron 主进程
// 职责：启动内置 Next.js standalone server → 打开桌面窗口 → 托盘常驻 → 退出清理
"use strict";

// 防御：若环境残留 ELECTRON_RUN_AS_NODE，本进程会退化成纯 Node，导致 require('electron') 失效
delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const https = require("https");
const os = require("os");

const APP_NAME = "PLM研发协同平台";
const DEFAULT_PORT = 43123;
// 在注册 ready 工作前先取得单实例锁，避免两个便携包同时解压后各自启动窗口/服务。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// ============ 运行配置（构建时注入 builtin-env.json，用户可覆盖） ============
function loadConfig() {
  const cfg = {
    port: DEFAULT_PORT,
    serverUrl: "",
    updateFeed: "",
    allowLocalServer: false,
  };
  // 1) 构建时内置公开配置（只允许服务地址/更新源，不包含数据库与认证密钥）
  for (const base of [app.getAppPath(), path.join(app.getAppPath(), "..")]) {
    for (const sub of ["", "desktop"]) {
      try {
        const builtin = JSON.parse(
          fs.readFileSync(path.join(base, sub, "builtin-env.json"), "utf8")
        );
        Object.assign(cfg, builtin);
        break;
      } catch { /* 继续尝试下一候选 */ }
    }
  }
  // 2) 用户配置覆盖（%APPDATA%/plm-workspace/config.json）
  try {
    const userCfg = JSON.parse(
      fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf8")
    );
    Object.assign(cfg, userCfg);
  } catch { /* 无用户配置 */ }
  return cfg;
}

// ============ 端口检测与启动内置 server ============
function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(findFreePort(start + 1)));
    srv.listen(start, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function getServerDir() {
  const candidates = [
    path.join(app.getAppPath(), ".next", "standalone"), // 打包后（resources/app）
    path.join(app.getAppPath(), "..", ".next", "standalone"), // 开发模式（项目根）
    path.join(process.resourcesPath, "app.asar.unpacked", ".next", "standalone"), // 打包后（asar 外，兼容）
    path.join(process.resourcesPath, "app", ".next", "standalone"),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, "server.js")));
}

async function startServer(cfg) {
  const serverDir = getServerDir();
  if (!serverDir) {
    dialog.showErrorBox(APP_NAME, "未找到内置服务，安装包可能损坏。");
    app.quit();
    return null;
  }
  const port = await findFreePort(cfg.port || DEFAULT_PORT);
  // 用 Electron 的 node 运行时启动 standalone server（ELECTRON_RUN_AS_NODE=1）
  const proc = spawn(process.execPath, [path.join(serverDir, "server.js")], {
    cwd: serverDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      // 本地服务仅用于显式开发模式，凭据必须来自启动环境，绝不随安装包分发。
      DATABASE_URL: process.env.DATABASE_URL || "",
      AUTH_SECRET: process.env.AUTH_SECRET || "",
      AUTH_TRUST_HOST: "true",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  // server 日志落盘（便于诊断）
  const logPath = path.join(app.getPath("userData"), "server.log");
  try {
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    proc.stdout.pipe(logStream);
    proc.stderr.pipe(logStream);
  } catch { /* 日志不可写则忽略 */ }
  proc.on("error", (e) => console.error("[plm-main] server spawn error:", e.message));
  proc.on("exit", (code) => {
    if (!app.isQuitting) {
      console.error("内置服务意外退出:", code);
      dialog.showErrorBox(APP_NAME, "内置服务意外退出，请重启应用。");
      app.quit();
    }
  });
  // 等待 server 就绪（轮询端口）
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (await isPortOpen(port)) return { proc, url, port };
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill();
  dialog.showErrorBox(APP_NAME, "内置服务启动超时。");
  app.quit();
  return null;
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port, timeout: 800 });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
  });
}

// ============ 窗口与托盘 ============
let mainWindow = null;
let configWindow = null;
let tray = null;

function showConfigWindow() {
  if (configWindow && !configWindow.isDestroyed()) {
    configWindow.show();
    configWindow.focus();
    return;
  }
  const quitOnClose = !mainWindow || mainWindow.isDestroyed();
  configWindow = new BrowserWindow({
    width: 620,
    height: 420,
    resizable: false,
    title: `${APP_NAME} - 首次配置`,
    webPreferences: {
      preload: path.join(__dirname, "config-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  configWindow.setMenuBarVisibility(false);
  configWindow.on("closed", () => {
    configWindow = null;
    if (quitOnClose && !app.isQuitting) {
      app.isQuitting = true;
      app.quit();
    }
  });
  configWindow.loadFile(path.join(__dirname, "config.html"));
}

function createWindow(url) {
  const allowedOrigin = new URL(url).origin;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 720,
    title: APP_NAME,
    icon: path.join(app.getAppPath(), "desktop", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith("https://")) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== allowedOrigin) {
      event.preventDefault();
      if (target.startsWith("https://")) shell.openExternal(target);
    }
  });
  let handlingLoadFailure = false;
  mainWindow.webContents.on("did-fail-load", async (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || handlingLoadFailure || app.isQuitting) return;
    handlingLoadFailure = true;
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "无法连接 PLM 服务",
      message: "服务器地址不可用或网络连接失败。",
      detail: `${errorDescription}（${errorCode}）`,
      buttons: ["重试", "重新配置服务器"],
      defaultId: 0,
      cancelId: 1,
    });
    handlingLoadFailure = false;
    if (result.response === 0) {
      mainWindow?.reload();
    } else {
      mainWindow?.destroy();
      mainWindow = null;
      showConfigWindow();
    }
  });
  mainWindow.loadURL(url);
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      tray?.displayBalloon?.({ title: APP_NAME, content: "已最小化到托盘，继续在后台运行。" });
    }
  });
}

function createTray() {
  try {
    tray = new Tray(path.join(app.getAppPath(), "desktop", "icon.ico"));
  } catch {
    return; // 图标缺失则跳过托盘
  }
  const menu = Menu.buildFromTemplate([
    { label: "打开主界面", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: "检查更新", click: () => { updateService?.checkAndPrompt(); } },
    { label: "服务器设置", click: () => showConfigWindow() },
    { type: "separator" },
    { label: "退出", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(menu);
  tray.on("double-click", () => { mainWindow?.show(); });
}

// ============ 更新（阶段3 接入 GitHub Releases） ============
let updateService = null;
ipcMain.handle("app:check-update", async () => {
  if (updateService) return updateService.checkAndPrompt();
  return { ok: false, message: "更新模块未启用" };
});
ipcMain.handle("app:get-info", () => ({
  version: app.getVersion(),
  appPath: app.getAppPath(),
  userData: app.getPath("userData"),
}));
ipcMain.handle("app:get-server-config", () => ({ serverUrl: loadConfig().serverUrl || "" }));

function checkServerReachable(serverUrl) {
  return new Promise((resolve, reject) => {
    const req = https.get(serverUrl, { timeout: 10000 }, (res) => {
      res.resume();
      if ((res.statusCode || 500) < 500) resolve();
      else reject(new Error(`服务返回 HTTP ${res.statusCode}`));
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("连接超时")));
  });
}

ipcMain.handle("app:save-server-config", async (_event, rawUrl) => {
  const serverUrl = String(rawUrl ?? "").trim().replace(/\/$/, "");
  let parsed;
  try { parsed = new URL(serverUrl); } catch { return { ok: false, message: "请输入有效的 HTTPS 地址" }; }
  if (parsed.protocol !== "https:" || !parsed.hostname) return { ok: false, message: "服务地址必须使用 HTTPS" };
  try {
    await checkServerReachable(serverUrl);
  } catch (error) {
    return { ok: false, message: `无法连接该服务：${error.message}` };
  }
  const configPath = path.join(app.getPath("userData"), "config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ serverUrl, allowLocalServer: false }, null, 2), "utf8");
  setTimeout(() => {
    app.relaunch();
    app.isQuitting = true;
    app.quit();
  }, 200);
  return { ok: true };
});

// ============ 生命周期 ============
// 软件渲染：兼容远程桌面/虚拟机/无独显环境。
// 独立 GPU 进程在驱动异常环境会崩溃并触发 FATAL；in-process-gpu 将 GPU 线程并入主进程（软件渲染）以彻底规避。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("in-process-gpu");
if (gotLock) app.whenReady().then(async () => {
  const cfg = loadConfig();
  let started = null;
  let appUrl = "";
  if (typeof cfg.serverUrl === "string" && /^https:\/\//i.test(cfg.serverUrl)) {
    appUrl = cfg.serverUrl.replace(/\/$/, "");
  } else if (cfg.allowLocalServer === true) {
    if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET) {
      dialog.showErrorBox(APP_NAME, "本地开发模式需要通过启动环境提供 DATABASE_URL 与 AUTH_SECRET。");
      app.quit();
      return;
    }
    started = await startServer(cfg);
    if (!started) return;
    app.__serverProc = started.proc;
    appUrl = started.url;
  } else {
    showConfigWindow();
    return;
  }
  createWindow(appUrl);
  createTray();

  // 阶段3：注册更新服务（GitHub Releases + SHA-256 校验 + 手动切换新包）
  try {
    const { registerUpdater } = require("./updater");
    updateService = registerUpdater({ app, mainWindow, cfg });
    setTimeout(() => updateService?.checkAndPrompt({ silentWhenCurrent: true }), 5000);
  } catch (error) {
    console.error("[plm-main] 更新模块初始化失败:", error);
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (app.__serverProc) {
    app.__serverProc.kill();
    app.__serverProc = null;
  }
});
app.on("window-all-closed", () => { /* 托盘常驻，不退出 */ });

// 第二次启动时只激活已经运行的窗口。
if (gotLock) {
  app.on("second-instance", () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}
