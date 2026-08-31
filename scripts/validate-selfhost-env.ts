export {};

const postgresPassword = process.env.SELFHOST_POSTGRES_PASSWORD ?? "";
const authSecret = process.env.SELFHOST_AUTH_SECRET ?? "";
const agentSecrets = [
  process.env.SELFHOST_AGENT_INTERNAL_SERVICE_SECRET ?? "",
  process.env.SELFHOST_AGENT_DELEGATION_SECRET ?? "",
  process.env.SELFHOST_AGENT_CURSOR_SECRET ?? "",
  process.env.SELFHOST_AGENT_ACTION_APPROVAL_SECRET ?? "",
];
const tunnelToken = process.env.CLOUDFLARE_TUNNEL_TOKEN ?? "";
const agentModelProvider = process.env.AGENT_MODEL_PROVIDER ?? "openai-compatible";
const agentModelBaseUrl = process.env.AGENT_MODEL_BASE_URL ?? "https://api.deepseek.com";
const agentModelApiKey = process.env.AGENT_MODEL_API_KEY ?? "";
const agentModelName = process.env.AGENT_MODEL_NAME ?? "deepseek-v4-flash";
const agentModelThinking = process.env.AGENT_MODEL_THINKING ?? "disabled";
const agentModelMaxOutputTokens = Number(process.env.AGENT_MODEL_MAX_OUTPUT_TOKENS ?? "2048");
const composeProject = process.env.SELFHOST_COMPOSE_PROJECT ?? "";
const backupIntervalSeconds = Number(process.env.SELFHOST_BACKUP_INTERVAL_SECONDS ?? "86400");
const backupRetentionDays = Number(process.env.SELFHOST_BACKUP_RETENTION_DAYS ?? "7");

const urlSafePattern = /^[A-Za-z0-9._~-]+$/;
const publicPlaceholderPattern = /^(?:(?:replace(?:_|-)?me|change(?:_|-)?me|changeme|todo|example|password|secret|placeholder|demo)[0-9._~-]*|your(?:_|-)?(?:secret|password|token|value)[0-9._~-]*)$/i;
const errors: string[] = [];

// 密码会直接拼接到 DATABASE_URL，因而只能使用 RFC3986 unreserved 字符。
if (postgresPassword.length < 24 || !urlSafePattern.test(postgresPassword) || new Set(postgresPassword).size < 8) {
  errors.push("SELFHOST_POSTGRES_PASSWORD 必须至少 24 位，且只能包含 URL-safe 字符");
}
if (authSecret.length < 32 || !urlSafePattern.test(authSecret) || new Set(authSecret).size < 8 || publicPlaceholderPattern.test(authSecret)) {
  errors.push("SELFHOST_AUTH_SECRET 必须是至少 32 位的非占位 URL-safe 随机值");
}
if (publicPlaceholderPattern.test(postgresPassword)) {
  errors.push("SELFHOST_POSTGRES_PASSWORD 不能使用公开占位值");
}
if (postgresPassword === authSecret) errors.push("数据库密码与 AUTH_SECRET 必须不同");
for (const secret of agentSecrets) {
  if (secret.length < 32 || !urlSafePattern.test(secret) || new Set(secret).size < 8 || publicPlaceholderPattern.test(secret)) {
    errors.push("四个 SELFHOST_AGENT_*_SECRET 必须分别是至少 32 位的非占位 URL-safe 随机值");
    break;
  }
}
if (new Set(agentSecrets).size !== agentSecrets.length) errors.push("四个 Agent Secret 必须互不相同");
if (agentSecrets.includes(postgresPassword) || agentSecrets.includes(authSecret)) errors.push("Agent Secret 不得复用数据库密码或 AUTH_SECRET");
if (composeProject !== "workbuddy-selfhost") errors.push("SELFHOST_COMPOSE_PROJECT 必须精确等于 workbuddy-selfhost");
if (!Number.isInteger(backupIntervalSeconds) || backupIntervalSeconds < 3600 || backupIntervalSeconds > 604800) {
  errors.push("SELFHOST_BACKUP_INTERVAL_SECONDS 必须在 3600 到 604800 秒之间");
}
if (!Number.isInteger(backupRetentionDays) || backupRetentionDays < 1 || backupRetentionDays > 90) {
  errors.push("SELFHOST_BACKUP_RETENTION_DAYS 必须在 1 到 90 天之间");
}
if (tunnelToken && (!tunnelToken.startsWith("eyJ") || tunnelToken.length < 80 || !/^[A-Za-z0-9._-]+$/.test(tunnelToken))) {
  errors.push("CLOUDFLARE_TUNNEL_TOKEN 必须为空或为有效的长 JWT 形状令牌");
}
if (agentModelProvider !== "openai-compatible") errors.push("AGENT_MODEL_PROVIDER 必须精确等于 openai-compatible");
if (agentModelBaseUrl !== "https://api.deepseek.com") errors.push("AGENT_MODEL_BASE_URL 必须使用批准的 HTTPS DeepSeek 地址");
if (agentModelName !== "deepseek-v4-flash") errors.push("AGENT_MODEL_NAME 必须精确等于 deepseek-v4-flash");
if (agentModelThinking !== "disabled") errors.push("AGENT_MODEL_THINKING 必须精确等于 disabled");
if (!Number.isInteger(agentModelMaxOutputTokens) || agentModelMaxOutputTokens < 256 || agentModelMaxOutputTokens > 4096) {
  errors.push("AGENT_MODEL_MAX_OUTPUT_TOKENS 必须在 256 到 4096 之间");
}
const agentModelApiKeyBody = agentModelApiKey.replace(/^sk-/i, "");
if (
  agentModelApiKey &&
  (!/^sk-[A-Za-z0-9_-]{20,}$/.test(agentModelApiKey) ||
    new Set(agentModelApiKey).size < 8 ||
    publicPlaceholderPattern.test(agentModelApiKey) ||
    publicPlaceholderPattern.test(agentModelApiKeyBody))
) {
  errors.push("AGENT_MODEL_API_KEY 形状或强度无效");
}

if (errors.length > 0) throw new Error(`[selfhost-env] 配置无效：${errors.join("；")}`);
console.log("[selfhost-env] validated=true");
