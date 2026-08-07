// 预加载脚本：向渲染进程暴露最小可用 API（不开启 nodeIntegration）
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("plmDesktop", {
  version: () => ipcRenderer.invoke("app:get-info"),
  checkUpdate: () => ipcRenderer.invoke("app:check-update"),
  isDesktop: true,
});
