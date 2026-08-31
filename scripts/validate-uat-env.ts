export {};

const postgresPassword = process.env.UAT_POSTGRES_PASSWORD ?? "";
const authSecret = process.env.UAT_AUTH_SECRET ?? "";

// Compose 同时把数据库密码作为原始 POSTGRES_PASSWORD 和 URL 片段使用，
// 因此只允许无需 percent-encode 的 RFC3986 unreserved 字符。
if (postgresPassword.length < 24 || !/^[A-Za-z0-9._~-]+$/.test(postgresPassword)) {
  throw new Error("UAT_POSTGRES_PASSWORD 必须至少 24 位，且只能包含 A-Z a-z 0-9 . _ ~ -");
}
if (authSecret.length < 32 || /^(REPLACE_|CHANGE_ME|CHANGEME|TODO|EXAMPLE|YOUR_)/i.test(authSecret)) {
  throw new Error("UAT_AUTH_SECRET 必须是至少 32 字节的非占位随机值");
}
if (postgresPassword === authSecret) throw new Error("数据库密码与 AUTH_SECRET 必须相互独立");

console.log("[uat-env] validated=true");
