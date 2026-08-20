"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("plmConfig", {
  getServerConfig: () => ipcRenderer.invoke("app:get-server-config"),
  saveServerUrl: (serverUrl) => ipcRenderer.invoke("app:save-server-config", serverUrl),
});
