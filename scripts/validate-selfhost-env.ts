const postgresPassword = process.env.SELFHOST_POSTGRES_PASSWORD ?? "";
const authSecret = process.env.SELFHOST_AUTH_SECRET ?? "";
const tunnelToken = process.env.CLOUDFLARE_TUNNEL_TOKEN ?? "";
const backupIntervalSeconds = Number(process.env.SELFHOST_BACKUP_INTERVAL_SECONDS ?? "86400");
const backupRetentionDays = Number(process.env.SELFHOST_BACKUP_RETENTION_DAYS ?? "7");

const urlSafePattern = /^[A-Za-z0-9._~-]+$/;
const publicPlaceholderPattern = /^(?:(?:replace(?:_|-)?me|change(?:_|-)?me|changeme|todo|example|password|secret|placeholder|demo)[0-9._~-]*|your(?:_|-)?(?:secret|password|token|value)[0-9._~-]*)$/i;
const errors: string[] = [];

// 密码会直接拼接到 DATABASE_URL，因而只能使用 RFC3986 unreserved 字符。
if (postgresPassword.length < 24 || !urlSafePattern.test(postgresPassword)) {
  errors.push("SELFHOST_POSTGRES_PASSWORD 必须至少 24 位，且只能包含 URL-safe 字符");
}
if (authSecret.length < 32 || !urlSafePattern.test(authSecret) || publicPlaceholderPattern.test(authSecret)) {
  errors.push("SELFHOST_AUTH_SECRET 必须是至少 32 位的非占位 URL-safe 随机值");
}
if (publicPlaceholderPattern.test(postgresPassword)) {
  errors.push("SELFHOST_POSTGRES_PASSWORD 不能使用公开占位值");
}
if (postgresPassword === authSecret) errors.push("数据库密码与 AUTH_SECRET 必须不同");
if (!Number.isInteger(backupIntervalSeconds) || backupIntervalSeconds < 3600 || backupIntervalSeconds > 604800) {
  errors.push("SELFHOST_BACKUP_INTERVAL_SECONDS 必须在 3600 到 604800 秒之间");
}
if (!Number.isInteger(backupRetentionDays) || backupRetentionDays < 1 || backupRetentionDays > 90) {
  errors.push("SELFHOST_BACKUP_RETENTION_DAYS 必须在 1 到 90 天之间");
}
if (tunnelToken && (!tunnelToken.startsWith("eyJ") || tunnelToken.length < 80 || !/^[A-Za-z0-9._-]+$/.test(tunnelToken))) {
  errors.push("CLOUDFLARE_TUNNEL_TOKEN 必须为空或为有效的长 JWT 形状令牌");
}

if (errors.length > 0) throw new Error(`[selfhost-env] 配置无效：${errors.join("；")}`);
console.log("[selfhost-env] validated=true");
