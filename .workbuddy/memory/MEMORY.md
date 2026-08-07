# PLM 平台项目长期记忆

## 交付决策（2026-08-06 用户确认）
- 云端数据库：**Neon PostgreSQL**（免费档，Singapore 区域）——Prisma provider 从 sqlite 切 postgresql
- exe 数据模式：**纯云端共享**（所有客户端连同一云库）
- 打包：**Electron portable exe**（免安装）+ electron-builder；Next.js `output: 'standalone'`
- 在线更新：**GitHub Releases + electron-updater**（portable 需自定义"下载新包替换重启"更新器；国内走 ghproxy 镜像加速）
- 实施顺序：①接云端库（等用户提供 Neon 连接串）②Electron 打包 ③GitHub 更新 ④文档验收

## 环境要点（本机）
- 用户真实 PowerShell 运行正常；Bash 工具沙箱内 npm/构建/SQLite 有特殊限制（见当日日志）
- npm 安装姿势：`NODE_OPTIONS="--use-system-ca" npm install --registry=https://registry.npmmirror.com --cache <新目录>`
- 构建前若 .next 被 dev 污染需 `mv .next` 移开后冷构建（67~86s）
- 运行：`cd E:\workbuddy_pro && npm run dev`（PowerShell 5.1 不支持 &&）
- 账号：admin/pm/eng/guest@demo.com，密码 Demo@123456
