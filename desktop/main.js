// PLM 研发协同平台 —— Electron 主进程
// 职责：启动内置 Next.js standalone server → 打开桌面窗口 → 托盘常驻 → 退出清理
"use strict";

// 防御：若环境残留 ELECTRON_RUN_AS_NODE，本进程会退化成纯 Node，导致 require('electron') 失效
delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const os = require("os");

const APP_NAME = "PLM研发协同平台";
const DEFAULT_PORT = 43123;

// ============ 运行配置（构建时注入 builtin-env.json，用户可覆盖） ============
function loadConfig() {
  const cfg = {
    port: DEFAULT_PORT,
    databaseUrl: "",
    authSecret: "",
    updateFeed: "", // 阶段3：GitHub Releases 地址
  };
  // 1) 构建时内置配置（随 exe 分发，含默认云端连接串）
  for (const base of [app.getAppPath(), path.join(app.getAppPath(), "..")]) {
    try {
      const builtin = JSON.parse(
        fs.readFileSync(path.join(base, "builtin-env.json"), "utf8")
      );
      Object.assign(cfg, builtin);
      break;
    } catch { /* 继续尝试下一候选 */ }
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
      DATABASE_URL: cfg.databaseUrl,
      AUTH_SECRET: cfg.authSecret || "plm-desktop-default-secret",
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
let tray = null;

function createWindow(url) {
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
    },
  });
  mainWindow.setMenuBarVisibility(false);
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
    { label: "检查更新", click: () => { ipcMain.emit("check-update"); } },
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
  if (updateService) return updateService.check();
  return { ok: false, message: "更新模块未启用" };
});
ipcMain.handle("app:get-info", () => ({
  version: app.getVersion(),
  appPath: app.getAppPath(),
  userData: app.getPath("userData"),
}));

// ============ 生命周期 ============
// 软件渲染：兼容远程桌面/虚拟机/无独显环境（无 GPU 时避免 FATAL 退出）
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.whenReady().then(async () => {
  const cfg = loadConfig();
  const started = await startServer(cfg);
  if (!started) return;
  app.__serverProc = started.proc;
  createWindow(started.url);
  createTray();

  // 阶段3：注册更新服务（GitHub Releases + portable 替换式更新器）
  try {
    const { registerUpdater } = require("./updater");
    updateService = registerUpdater({ app, mainWindow, cfg, getServer: () => started });
  } catch { /* 更新模块未就绪时静默跳过 */ }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (app.__serverProc) {
    app.__serverProc.kill();
    app.__serverProc = null;
  }
});
app.on("window-all-closed", () => { /* 托盘常驻，不退出 */ });

// 单实例：避免重复启动
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}
